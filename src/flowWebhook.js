import { formatServicesPrettyFromBlob } from "./bookingEngine.js";

/**
 * Parse WhatsApp Flow completion from inbound webhook (interactive.nfm_reply).
 * @see https://developers.facebook.com/docs/whatsapp/flows/guides/receiveflowresponse/
 */

export function parseNfmReplyPayload(msg) {
  const nfm = msg?.interactive?.nfm_reply;
  if (!nfm) return null;

  const raw = nfm.response_json;
  if (raw == null) return null;

  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object") {
      if (parsed.response && typeof parsed.response === "object") {
        return { ...parsed, ...parsed.response };
      }
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

/** Static feedback Flow completion — booking completions always include `booking_date`. */
export function isFeedbackFlowPayload(data) {
  if (!data || typeof data !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(data, "booking_date")) return false;
  return Object.prototype.hasOwnProperty.call(data, "rate_hair_service");
}

export function formatFeedbackThankYou(data) {
  if (!data || typeof data !== "object") {
    return "💚 Thank you for your feedback! — Green Trends";
  }

  const recRaw = String(data.feedback_recommend || "—");
  const recPretty = recRaw.includes("Yes") || recRaw === "0_Yes" ? "Yes" : recRaw.includes("No") || recRaw === "1_No" ? "No" : recRaw;
  const comment = String(data.feedback_comment || "").trim();

  const starLabel = (id) => {
    const m = String(id || "").match(/^(\d)_/);
    if (!m) return id || "—";
    const labels = ["Excellent (5/5)", "Good (4/5)", "Average (3/5)", "Poor (2/5)", "Very Poor (1/5)"];
    return labels[Number(m[1])] || id;
  };

  const lines = [
    "💚 *Thank you for your feedback!*",
    "",
    `*Recommend Green Trends:* ${recPretty}`
  ];
  if (comment) {
    lines.push("", `*Your comment:* ${comment}`);
  }
  lines.push(
    "",
    `*Hair & styling:* ${starLabel(data.rate_hair_service)}`,
    `*Salon cleanliness:* ${starLabel(data.rate_salon_cleanliness)}`,
    `*Staff courtesy:* ${starLabel(data.rate_staff_courtesy)}`,
    "",
    "_Green Trends — Unisex Hair & Style Salon_"
  );
  return lines.join("\n");
}

export function formatBookingSummaryFromFlow(data) {
  if (!data || typeof data !== "object") {
    return "Thank you. We received your booking request and will contact you shortly.";
  }

  const name = data.customer_name || "Customer";
  const salon = data.salon_name || data.salon_id || "Salon";
  const service =
    data.service_item_pretty ||
    formatServicesPrettyFromBlob(data.service_blob) ||
    data.service_item ||
    data.service_category ||
    "—";
  const when = data.booking_date || "—";
  const time = data.slot_id || "—";
  const stylist = data.stylist_name || data.stylist_id || "—";
  const bookingId = data.booking_id || (data.flow_token ? `GT-FLOW-${data.flow_token}` : "—");
  const lines = [
    `✅ *Green Trends — Booking Request Received*`,
    ``,
    `Hello ${name} 👋`,
    ``,
    `Your booking request has been received. We will contact you shortly.`,
    ``,
    `*Salon:* ${salon}`,
    ``,
    ...(data.salon_address_line ? [`*Address:* ${data.salon_address_line}`] : []),
    ...(data.salon_address_line ? [""] : []),
    `💇 *Services:* ${service}`,
    ``,
    `📅 *Date:* ${when}`,
    ``,
    `⏰ *Time:* ${time}`,
    ``,
    `👩‍🔧 *Stylist:* ${stylist}`
  ];

  lines.push(
    ``,
    `Our team will contact you shortly to confirm your slot. Thank you for your patience.`,
    ``,
    `_💚 Green Trends — Unisex Hair & Style Salon_`
  );

  return lines.join("\n");
}
