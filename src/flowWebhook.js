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
  return Object.prototype.hasOwnProperty.call(data, "overall_experience");
}

function starRatingLabel(id) {
  const m = String(id || "").match(/^(\d)_/);
  if (!m) return id || "—";
  const n = Number(m[1]);
  const labels = {
    5: "Excellent (5/5)",
    4: "Good (4/5)",
    3: "Average (3/5)",
    2: "Poor (2/5)",
    1: "Very poor (1/5)"
  };
  return labels[n] || id;
}

function serviceQualityLabel(id) {
  const map = {
    fully_satisfied: "Yes, fully satisfied",
    partially_satisfied: "Partially satisfied",
    not_satisfied: "Not satisfied"
  };
  return map[String(id)] || id || "—";
}

function valueForMoneyLabel(id) {
  const map = {
    worth_it: "Worth it",
    average_value: "Average",
    not_worth_it: "Not worth it"
  };
  return map[String(id)] || id || "—";
}

export function formatFeedbackThankYou(data) {
  if (!data || typeof data !== "object") {
    return "💚 Thank you for your feedback! — Green Trends";
  }

  const suggestion = String(data.improvement_suggestion || "").trim();

  const lines = [
    "💚 *Thank you for your feedback!*",
    "",
    "*Overall experience:* " + starRatingLabel(data.overall_experience),
    "*Staff service:* " + starRatingLabel(data.staff_service),
    "*Service quality:* " + serviceQualityLabel(data.service_quality),
    "*Value for money:* " + valueForMoneyLabel(data.value_for_money)
  ];
  if (suggestion) {
    lines.push("", "*Improvement / suggestion:*", suggestion);
  }
  lines.push("", "_Green Trends — Unisex Hair & Style Salon_");
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
