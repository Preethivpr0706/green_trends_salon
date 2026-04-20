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

export function formatBookingSummaryFromFlow(data) {
  if (!data || typeof data !== "object") {
    return "Thank you — we received your Green Trends booking request.";
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
  const maps = data.maps_url || "";

  const lines = [
    `✅ *Green Trends — booking received* 💇‍♀️`,
    ``,
    `Hi ${name},`,
    ``,
    `Thank you for booking with us — here is your summary:`,
    ``,
    `*Salon:* ${salon}`,
    ...(data.salon_address_line ? [`*Address:* ${data.salon_address_line}`] : []),
    `*Services:* ${service}`,
    `*Date:* ${when}`,
    `*Time:* ${time}`,
    `*Stylist:* ${stylist}`
  ];

  if (maps) {
    lines.push(``, `📍 *Maps:* ${maps}`);
  }

  lines.push(
    ``,
    `📋 Status: *Pending approval* at the salon (Phase 1 demo).`,
    ``,
    `_💚 Green Trends — Unisex Hair & Style Salon_`
  );

  return lines.join("\n");
}
