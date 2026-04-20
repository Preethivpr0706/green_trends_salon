import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { config, validateConfig } from "./config.js";
import {
  getSalonById,
  initDatabase,
  insertBooking,
  listBookingsByMobile,
  listAppointments,
  listBookings,
  listUsers
} from "./database.js";
import { createPendingBooking, formatServicesPrettyFromBlob, getNearestSalons } from "./bookingEngine.js";
import { decryptFlowRequest, encryptFlowResponse, loadFlowPrivateKeyPem } from "./flowCrypto.js";
import { handleFlowDataExchange } from "./flowHandlers.js";
import { formatBookingSummaryFromFlow, parseNfmReplyPayload } from "./flowWebhook.js";
import {
  getOnboarding,
  isGreeting,
  looksLikePincode,
  PHASE,
  setOnboarding
} from "./onboardingState.js";
import {
  sendBookingConfirmed,
  sendBookingFlow,
  sendFlowCompletionSummary,
  sendImage,
  sendLocationMessage,
  sendLocationRequestMessage,
  sendSalonListMessage,
  sendWelcomeActionButtons,
  sendText
} from "./whatsapp.js";
import { isAlreadyProcessedInbound } from "./webhookDedupe.js";
import { logWebhook, logWebhookError } from "./webhookLog.js";

validateConfig();
const dbPath = await initDatabase();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/static", express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "green-trends-whatsapp-bot" });
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.verifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/** Flow submit completion — do NOT run welcome again (was misclassified as interactive). */
async function handleFlowCompletion(msg) {
  const from = msg.from;
  const payload = parseNfmReplyPayload(msg);
  if (!payload) {
    logWebhook("flow_response", "could not parse nfm_reply.response_json");
    return;
  }

  logWebhook("flow_response", `parsed keys=${Object.keys(payload).join(",")}`);

  const summary = formatBookingSummaryFromFlow(payload);
  try {
    await sendFlowCompletionSummary(from, summary);
    logWebhook("send", "flow completion summary OK");
  } catch (e) {
    logWebhookError("send flow completion summary", e);
  }

  // Fallback persistence: ensures bookings are stored even if Flow completion
  // reaches webhook but `/flow` complete-action did not persist.
  try {
    const servicePretty =
      payload.service_item_pretty ||
      formatServicesPrettyFromBlob(payload.service_blob) ||
      payload.service_item ||
      payload.service_category ||
      "";

    const fallbackBooking = createPendingBooking({
      bookingId: `GT-FLOW-${payload.flow_token || msg.id || Date.now()}`,
      fullName: payload.customer_name || "",
      mobile: payload.customer_mobile || from || "",
      email: payload.customer_email || "",
      salonId: payload.salon_id || "",
      salonName: payload.salon_name || "",
      mapsUrl: payload.maps_url || "",
      gender: payload.gender || "",
      serviceCategory: payload.service_category || "Multiple",
      serviceItem: servicePretty,
      serviceBlob: payload.service_blob || "",
      date: payload.booking_date || "",
      stylistName: payload.stylist_name || payload.stylist_id || "No Preference",
      timeSlot: payload.slot_id || ""
    });

    await insertBooking(fallbackBooking);
    logWebhook("db", `booking persisted from nfm_reply id=${fallbackBooking.bookingId}`);
  } catch (persistErr) {
    logWebhookError("persist booking from nfm_reply", persistErr);
  }

  const salon = await getSalonById(payload.salon_id);
  if (salon && salon.lat != null && salon.lng != null) {
    try {
      await sendLocationMessage(from, {
        latitude: salon.lat,
        longitude: salon.lng,
        name: salon.name,
        address: `${salon.area}, ${salon.city}`.trim()
      });
      logWebhook("send", "location pin OK");
      try {
        await sendText(
          from,
          "💚 Thank you for choosing Green Trends — we truly appreciate your trust. We cannot wait to see you at the salon! ✨"
        );
        logWebhook("send", "post-location thank you OK");
      } catch (tyErr) {
        logWebhookError("send thank you after location", tyErr);
      }
    } catch (e) {
      logWebhookError("send location pin", e);
    }
  }
}

/** Hi → welcome image first, then native location request + pincode hint (Flow opens after list pick). */
async function sendWelcomeImageAndAskLocation(msg) {
  const from = msg.from;
  if (!from) return;

  logWebhook("welcome", `greeting from=${from} id=${msg.id || "n/a"}`);

  const caption = `💚 *Welcome to Green Trends*
Unisex Hair & Style Salon

We are glad you are here! Next we will find salons near you (3–10 options).`;

  try {
    await sendImage(from, config.welcomeImageUrl, caption);
    logWebhook("send", "welcome image OK");
  } catch (imgErr) {
    logWebhookError("welcome image (set PUBLIC_BASE_URL or WELCOME_IMAGE_URL)", imgErr);
  }

  try {
    await sendWelcomeActionButtons(from);
    logWebhook("send", "welcome action buttons OK");
  } catch (e) {
    logWebhookError("welcome action buttons", e);
    await sendText(from, "Reply with *book* to start booking or *view* to see your appointments.");
  }

  setOnboarding(from, { phase: PHASE.AWAITING_ACTION });
}

async function startBookingLocationFlow(from) {
  await delay(300);
  try {
    await sendLocationRequestMessage(from);
    logWebhook("send", "location_request_message OK");
  } catch (e) {
    logWebhookError("location_request_message (fallback text)", e);
    await sendText(
      from,
      "📍 Tap 📎 → *Location* → send your current location so we can list nearby Green Trends salons."
    );
  }

  await delay(300);
  try {
    await sendText(from, "✏️ Or type your *6-digit area pincode* here (e.g. 600080).");
    logWebhook("send", "pincode hint OK");
  } catch (e) {
    logWebhookError("pincode hint", e);
  }

  setOnboarding(from, { phase: PHASE.AWAITING_PIN_OR_LOCATION });
}

function formatAppointmentList(bookings) {
  if (!bookings.length) {
    return "🗂️ You do not have any appointments yet.\n\nTap *Book Appointment* to create one.";
  }

  const lines = ["🗂️ *Your recent appointments*"];
  bookings.slice(0, 5).forEach((b, idx) => {
    lines.push(
      "",
      `${idx + 1}. *${b.salonName || "Green Trends"}*`,
      `   Date: ${b.date || "-"}`,
      `   Time: ${b.timeSlot || "-"}`,
      `   Service: ${b.serviceItem || b.serviceCategory || "-"}`,
      `   Status: ${b.status || "PENDING_APPROVAL"}`
    );
  });
  return lines.join("\n");
}

async function sendAppointmentsForCustomer(from) {
  const bookings = await listBookingsByMobile(from, 5);
  await sendText(from, formatAppointmentList(bookings));
  await sendWelcomeActionButtons(from);
  setOnboarding(from, { phase: PHASE.AWAITING_ACTION });
}

async function presentNearbySalonsOrRetry(from, nearbySalons) {
  if (!nearbySalons || nearbySalons.length === 0) {
    await sendText(
      from,
      "🔍 We could not find salons for that. Please send another *6-digit pincode* or share your *location* again."
    );
    try {
      await sendLocationRequestMessage(from);
    } catch (e) {
      logWebhookError("location_request after empty nearby", e);
      await sendText(from, "You can also tap 📎 → *Location* in WhatsApp.");
    }
    return;
  }

  try {
    await sendSalonListMessage(from, nearbySalons);
    logWebhook("send", "salon list interactive OK");
    setOnboarding(from, { phase: PHASE.AWAITING_SALON_PICK });
  } catch (e) {
    logWebhookError("sendSalonListMessage", e);
    await sendText(from, "⚠️ Could not show the salon list. Please try again in a moment.");
  }
}

async function sendBookingFlowAfterSalonSelection(from, salon) {
  if (!config.flowIdBookAppointment || config.flowIdBookAppointment.includes("replace")) {
    logWebhook(
      "send flow",
      "SKIPPED — set FLOW_ID_BOOK_APPOINTMENT in .env to your published Flow ID (WhatsApp Manager → Flows)."
    );
    await sendText(
      from,
      "⚠️ Booking Flow is not configured yet. Ask your admin to set FLOW_ID_BOOK_APPOINTMENT."
    );
    return;
  }

  const addressLine = [salon.area, salon.city, salon.pincode].filter(Boolean).join(" · ");

  await sendBookingFlow(from, {
    customer_mobile: from,
    salon_id: salon.id,
    salon_name: salon.name,
    salon_address_line: addressLine,
    maps_url: salon.mapsUrl,
    salon_latitude: String(salon.lat),
    salon_longitude: String(salon.lng)
  });
  logWebhook("send", "interactive Flow OK (salon pre-selected)");
  setOnboarding(from, { phase: PHASE.FLOW_SENT });
}

async function handleSalonListReply(msg) {
  const from = msg.from;
  if (!from) return;
  const { phase } = getOnboarding(from);
  if (phase !== PHASE.AWAITING_SALON_PICK) {
    logWebhook("list_reply", `ignored — phase=${phase}`);
    return;
  }

  const salonId = msg.interactive?.list_reply?.id;
  if (!salonId) return;

  const salon = await getSalonById(salonId);
  if (!salon) {
    await sendText(from, "❗ That option is no longer valid. Please send *pincode* or *location* again.");
    setOnboarding(from, { phase: PHASE.AWAITING_PIN_OR_LOCATION });
    return;
  }

  logWebhook("list_reply", `picked salon=${salonId}`);

  try {
    await sendBookingFlowAfterSalonSelection(from, salon);
  } catch (e) {
    logWebhookError("sendBookingFlow after list pick", e);
  }
}

async function handleInboundLocation(msg) {
  const from = msg.from;
  if (!from) return;
  const { phase } = getOnboarding(from);
  if (phase !== PHASE.AWAITING_PIN_OR_LOCATION && phase !== PHASE.AWAITING_SALON_PICK) {
    logWebhook("location", `ignored — phase=${phase}`);
    return;
  }

  const lat = Number(msg.location?.latitude);
  const lng = Number(msg.location?.longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    await sendText(from, "❗ Could not read that location. Please try again or send a 6-digit pincode.");
    return;
  }

  const nearby = await getNearestSalons({ lat, lng });
  logWebhook("location", `lat=${lat} lng=${lng} salons=${nearby.length}`);
  await presentNearbySalonsOrRetry(from, nearby);
}

async function handleInboundText(msg) {
  const from = msg.from;
  if (!from) return;

  const text = msg.text?.body ?? "";
  const norm = text.trim().toLowerCase();
  const { phase } = getOnboarding(from);

  if (phase === PHASE.AWAITING_ACTION) {
    if (norm.includes("book")) {
      await startBookingLocationFlow(from);
      return;
    }
    if (norm.includes("view") || norm.includes("appointment")) {
      await sendAppointmentsForCustomer(from);
      return;
    }
    await sendText(from, "Please choose *Book Appointment* or *View Appointments*.");
    await sendWelcomeActionButtons(from);
    return;
  }

  if (phase === PHASE.AWAITING_SALON_PICK) {
    if (looksLikePincode(text)) {
      const nearby = await getNearestSalons({ pincode: text.trim() });
      logWebhook("pincode_refresh", `${text.trim()} → ${nearby.length} salons`);
      await presentNearbySalonsOrRetry(from, nearby);
      return;
    }
    await sendText(
      from,
      "👆 Tap *Choose salon* in the menu above and pick a row — or send a new *6-digit pincode* to refresh the list."
    );
    return;
  }

  if (phase === PHASE.AWAITING_PIN_OR_LOCATION) {
    if (looksLikePincode(text)) {
      const nearby = await getNearestSalons({ pincode: text.trim() });
      logWebhook("pincode", `${text.trim()} → ${nearby.length} salons`);
      await presentNearbySalonsOrRetry(from, nearby);
      return;
    }
    await sendText(
      from,
      "📌 Please send a valid *6-digit Indian pincode* (example: 600017) *or* share your live location 📎 → Location."
    );
    return;
  }

  if (phase === PHASE.FLOW_SENT && isGreeting(text)) {
    await sendText(
      from,
      "👋 You already have a *Book Appointment* button above — tap it to continue. Say *hi* anytime if you need the welcome message again (we will guide you). 💚"
    );
    return;
  }

  if (phase === PHASE.NONE && isGreeting(text)) {
    await sendWelcomeImageAndAskLocation(msg);
    return;
  }

  if (phase === PHASE.NONE) {
    await sendText(
      from,
      "👋 Hi! Say *hi* for the welcome, or send your *pincode* / *location* to find salons near you. 📍"
    );
    return;
  }

  if (phase === PHASE.FLOW_SENT) {
    await sendText(from, "👆 Tap *Book Appointment* above to continue your booking. 💚");
    return;
  }

  await sendText(
    from,
    "💬 Share your *6-digit pincode* or your *location* to see nearby salons — then use *Book Appointment*. ✨"
  );
}

async function handleActionButtonReply(msg) {
  const from = msg.from;
  if (!from) return;
  const btnId = msg.interactive?.button_reply?.id;
  if (!btnId) return;

  if (btnId === "action_book") {
    await startBookingLocationFlow(from);
    return;
  }

  if (btnId === "action_view") {
    await sendAppointmentsForCustomer(from);
  }
}

async function dispatchInboundMessage(msg) {
  const from = msg.from;
  if (!from) return;

  if (msg.type === "interactive") {
    const iType = msg.interactive?.type;
    if (iType === "nfm_reply") {
      await handleFlowCompletion(msg);
      return;
    }
    if (iType === "list_reply") {
      await handleSalonListReply(msg);
      return;
    }
    if (iType === "button_reply") {
      await handleActionButtonReply(msg);
      return;
    }
    logWebhook("inbound", `interactive ignored type=${iType || "unknown"} (not a Flow response)`);
    return;
  }

  if (msg.type === "location") {
    await handleInboundLocation(msg);
    return;
  }

  if (msg.type === "text") {
    await handleInboundText(msg);
    return;
  }

  logWebhook("inbound", `ignored type=${msg.type}`);
}

app.post("/webhook", (req, res) => {
  try {
    const entries = req.body?.entry || [];

    // Acknowledge immediately so Meta does not retry (avoids duplicate outbound messages).
    res.sendStatus(200);

    setImmediate(() => {
      (async () => {
        for (const entry of entries) {
          const changes = entry?.changes || [];
          for (const change of changes) {
            if (change.field !== "messages") continue;
            const messages = change.value?.messages || [];

            for (const msg of messages) {
              if (isAlreadyProcessedInbound(msg)) {
                logWebhook("dedupe", `skip duplicate id=${msg.id || msg.timestamp}`);
                continue;
              }
              try {
                await dispatchInboundMessage(msg);
              } catch (err) {
                logWebhookError("dispatchInboundMessage", err);
              }
            }
          }
        }
      })();
    });
  } catch (error) {
    console.error("Webhook error:", error.message);
    if (!res.headersSent) {
      res.sendStatus(500);
    }
  }
});

/**
 * Production Flow endpoint: Meta sends encrypted JSON (see FLOW_PUBLIC_KEY_SETUP.md).
 * Configure this exact HTTPS URL in WhatsApp Manager → Flow → Endpoint (no trailing slash required).
 */
async function handleEncryptedFlow(req, res) {
  const privateKeyPem = loadFlowPrivateKeyPem();
  if (!privateKeyPem) {
    console.error("FLOW_PRIVATE_KEY_PATH or FLOW_PRIVATE_KEY is not set");
    return res.status(503).type("text/plain").send("flow_private_key_missing");
  }

  try {
    const { decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptFlowRequest(
      req.body,
      privateKeyPem
    );
    const response = await handleFlowDataExchange(decryptedBody);
    const encrypted = encryptFlowResponse(response, aesKeyBuffer, initialVectorBuffer);
    return res.status(200).type("text/plain").send(encrypted);
  } catch (error) {
    console.error("Flow /flow error:", error.message);
    return res.status(421).type("text/plain").send("decryption_failed");
  }
}

app.get("/flow", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "whatsapp-flow-endpoint",
    post: "Send encrypted Flow requests (application/json) to this URL with POST."
  });
});

app.post("/flow", handleEncryptedFlow);
app.post("/flow/", handleEncryptedFlow);

/** Local / dev only: plaintext JSON (do not expose publicly). */
app.post("/flow/data-exchange", async (req, res) => {
  if (process.env.FLOW_ALLOW_PLAINTEXT !== "true") {
    return res.status(404).json({ error: "not_found" });
  }
  try {
    const response = await handleFlowDataExchange(req.body);
    return res.status(200).json(response);
  } catch (error) {
    console.error("Flow data exchange error:", error.message);
    return res.status(500).json({ error: "flow_data_exchange_failed" });
  }
});

// Mock manager approval callback endpoint.
app.post("/internal/mock-approve", async (req, res) => {
  const { to, booking } = req.body || {};
  if (!to || !booking) {
    return res.status(400).json({ error: "to and booking are required" });
  }

  try {
    await sendBookingConfirmed(to, booking);
    return res.json({ ok: true, status: "CONFIRMED" });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/internal/bookings", async (_req, res) => {
  try {
    const bookings = await listBookings();
    return res.json({ ok: true, total: bookings.length, bookings });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/internal/users", async (_req, res) => {
  try {
    const users = await listUsers();
    return res.json({ ok: true, total: users.length, users });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/internal/appointments", async (_req, res) => {
  try {
    const appointments = await listAppointments();
    return res.json({ ok: true, total: appointments.length, appointments });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.listen(config.port, "0.0.0.0", () => {
  console.log(`Green Trends WhatsApp bot listening on http://0.0.0.0:${config.port}`);
  console.log(`Database: ${dbPath}`);
  console.log(`Flow endpoint: POST http://localhost:${config.port}/flow (use same path behind ngrok)`);
  console.log(
    `Welcome image URL resolved to: ${config.welcomeImageUrl} (set PUBLIC_BASE_URL=https://your-ngrok-host for /static/green-trends-welcome.png)`
  );
});
