import axios from "axios";
import { config } from "./config.js";
import {
  formatSalonListDescription,
  getSalonListTitle,
  getGenderRadioOptions
} from "./bookingEngine.js";

const baseUrl = `https://graph.facebook.com/v22.0/${config.phoneNumberId}/messages`;

async function sendMessage(payload) {
  if (!config.whatsappToken || !config.phoneNumberId) {
    throw new Error("Missing WhatsApp credentials in .env");
  }

  const { data, status } = await axios.post(baseUrl, payload, {
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`,
      "Content-Type": "application/json"
    },
    validateStatus: () => true
  });

  if (status >= 400 || data?.error) {
    const err = data?.error || { message: `HTTP ${status}` };
    const parts = [
      err.message || JSON.stringify(err),
      err.code != null ? `code=${err.code}` : null,
      err.error_subcode != null ? `subcode=${err.error_subcode}` : null,
      err.error_data ? `data=${JSON.stringify(err.error_data)}` : null,
      err.fbtrace_id ? `fbtrace_id=${err.fbtrace_id}` : null
    ].filter(Boolean);
    throw new Error(`WhatsApp API: ${parts.join(" | ")}`);
  }

  return data;
}

export async function sendText(to, body) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body }
  });
}

/** Direct HTTPS URL to a JPEG/PNG; WhatsApp fetches this server-side (no auth). */
export async function sendImage(to, imageLink, caption) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: {
      link: imageLink,
      caption
    }
  });
}

/** Must match ENTRY screen `data` in the published Flow JSON (dynamic_object — empty `{}` is rejected). */
function entryFlowInitialData() {
  return {
    customer_name: "",
    customer_mobile: "",
    customer_email: "",
    gender_options: getGenderRadioOptions(),
    salon_id: "",
    salon_name: "",
    salon_address_line: "",
    maps_url: "",
    salon_latitude: "",
    salon_longitude: ""
  };
}

/**
 * Native WhatsApp "Send location" CTA (within 24h session).
 * @see https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages/location-request-messages/
 */
export async function sendLocationRequestMessage(to, bodyText) {
  const text =
    bodyText ||
    "📍 Tap *Send location* below so we can list nearby Green Trends salons for you.";
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "location_request_message",
      body: { text },
      action: { name: "send_location" }
    }
  });
}

/** Interactive list (max 10 rows). Each row id = salon_id. */
export async function sendSalonListMessage(to, salonRows, headerText) {
  const rows = (salonRows || []).slice(0, 10).map((s) => ({
    id: s.id,
    title: getSalonListTitle(s),
    description: formatSalonListDescription(s)
  }));

  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: headerText || "Nearby salons ✨" },
      body: {
        text: "Tap a salon to book — address is shown on each row. You can pick gender & services next."
      },
      footer: { text: "Green Trends" },
      action: {
        button: "Choose salon",
        sections: [{ title: "Near you", rows }]
      }
    }
  });
}

export async function sendWelcomeActionButtons(to) {
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: "What would you like to do next?"
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: "action_book", title: "Book Appointment" }
          }
        ]
      }
    }
  });
}

export async function sendBookingFlow(to, initialData = {}, flowToken = "") {
  const data = { ...entryFlowInitialData(), ...initialData };
  const token = String(flowToken || `token_${Date.now()}`);

  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "flow",
      header: {
        type: "text",
        text: "Green Trends Appointment Booking"
      },
      body: {
        text: "✨ Tap below to pick services, date & time — we will confirm with the salon."
      },
      footer: {
        text: "COCO & FOFO booking assistant"
      },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: token,
          flow_id: config.flowIdBookAppointment,
          flow_cta: "Book Appointment",
          flow_action: "navigate",
          flow_action_payload: {
            screen: "ENTRY",
            data
          }
        }
      }
    }
  });
}

export async function sendBookingConfirmed(to, booking) {
  const stylistName = booking.stylistName === "No Preference"
    ? "Auto Assigned Stylist"
    : booking.stylistName;

  return sendText(
    to,
    [
      "✅ *Booking Confirmed*",
      "",
      `*Salon:* ${booking.salonName || "-"}`,
      `*Date:* ${booking.date || "-"}`,
      `*Time:* ${booking.timeSlot || "-"}`,
      `*Stylist:* ${stylistName || "-"}`,
      "",
      "We will share the location pin separately in chat. 💚"
    ].join("\n")
  );
}

export async function sendBookingRejected(to, reason, alternateSlots) {
  const slotText = alternateSlots.length
    ? `\nAlternate slots: ${alternateSlots.join(", ")}`
    : "";
  return sendText(
    to,
    `Sorry, the selected slot could not be confirmed (${reason}). Please choose another time.${slotText}`
  );
}

export async function sendFlowCompletionSummary(to, bodyText) {
  return sendText(to, bodyText);
}

/** WhatsApp native location pin (opens in Maps). Requires lat/lng numbers. */
export async function sendLocationMessage(to, { latitude, longitude, name, address }) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    throw new Error("sendLocationMessage: invalid latitude/longitude");
  }
  return sendMessage({
    messaging_product: "whatsapp",
    to,
    type: "location",
    location: {
      latitude: lat,
      longitude: lng,
      name: name || undefined,
      address: address || undefined
    }
  });
}
