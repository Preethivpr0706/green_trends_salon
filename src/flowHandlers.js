import {
  appendServiceBlob,
  createPendingBooking,
  formatServicesPrettyFromBlob,
  getCategoryOptionsForGender,
  getSalonByIdFromCache,
  getGenderRadioOptions,
  getStylistsByGender,
  parseServiceBlobParts,
  parseServiceOptionId
} from "./bookingEngine.js";
import { createAppointment, fetchSlots } from "./gtlApi.js";
import { config } from "./config.js";
import { getFlowSession, insertBooking, setFlowSession } from "./database.js";

function getSession(flowToken) {
  return getFlowSession(flowToken);
}

function mergeAndSaveSession(flowToken, session, patch) {
  const next = { ...session, ...patch };
  setFlowSession(flowToken, next);
  return next;
}

async function stylistDisplayName(salonId, stylistId, gender = "any") {
  const list = await getStylistsByGender(salonId, gender);
  const match = list.find((s) => s.id === stylistId);
  return match ? match.name : stylistId;
}

function normAction(action) {
  return String(action || "")
    .trim()
    .toLowerCase();
}

function fallbackCategoryOptions() {
  return [
    { id: "haircut", title: "Haircut" },
    { id: "facial", title: "Facial" },
    { id: "cleanup", title: "Clean up" },
    { id: "detan", title: "Detan" },
    { id: "hair_spa", title: "Hair Spa" }
  ];
}

async function safeCategoryOptionsForGender(gender) {
  try {
    const options = await getCategoryOptionsForGender(gender);
    if (Array.isArray(options) && options.length > 0) return options;
    console.warn("[flow] category_options empty, using fallback");
    return fallbackCategoryOptions();
  } catch (error) {
    console.warn("[flow] category_options failed, using fallback", error.message);
    return fallbackCategoryOptions();
  }
}

function normalizeTimeForApi(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const firstPart = raw.split("-")[0].trim();
  const m = firstPart.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!m) return firstPart;
  let hh = Number(m[1]);
  const mm = String(m[2]).padStart(2, "0");
  const meridiem = (m[3] || "").toUpperCase();
  if (meridiem) {
    if (meridiem === "PM" && hh !== 12) hh += 12;
    if (meridiem === "AM" && hh === 12) hh = 0;
  }
  return `${String(hh).padStart(2, "0")}:${mm}`;
}

function todayIsoDate() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isPastDate(value) {
  const selected = String(value || "").trim();
  if (!selected) return false;
  return selected < todayIsoDate();
}

function timeStringToMinutes(value) {
  const base = String(value || "")
    .split("-")[0]
    .trim();
  const m = base
    .trim()
    .match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const meridiem = m[3].toUpperCase();
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (meridiem === "PM" && hour !== 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function filterSlotsFromCurrentTime(slots, bookingDate) {
  const selected = String(bookingDate || "").trim();
  if (!selected || selected !== todayIsoDate()) {
    return Array.isArray(slots) ? slots : [];
  }
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const slotList = Array.isArray(slots) ? slots : [];
  return slotList.filter((slot) => {
    const raw = typeof slot === "string" ? slot : slot?.id || slot?.title;
    const slotMinutes = timeStringToMinutes(raw);
    return slotMinutes != null && slotMinutes > nowMinutes;
  });
}

async function buildReviewScreenData(incoming, session) {
  const d = { ...session, ...incoming };
  const salon = getSalonByIdFromCache(d.salon_id);
  const blob = String(d.service_blob || "");
  const service_item_pretty =
    formatServicesPrettyFromBlob(blob) || String(d.service_item_pretty || "");

  let stylist_name = "";
  stylist_name =
    (await stylistDisplayName(d.salon_id, d.stylist_id, d.gender)) || String(d.stylist_name || "");

  const salon_name = String(salon?.name || d.salon_name || "");
  const maps_url = String(salon?.mapsUrl || d.maps_url || "");
  const salon_address_line = String(d.salon_address_line ?? salon?.addressLine1 ?? "");

  const row = {
    customer_name: String(d.customer_name ?? ""),
    customer_mobile: String(d.customer_mobile ?? ""),
    customer_email: String(d.customer_email ?? ""),
    salon_id: String(d.salon_id ?? ""),
    salon_name,
    salon_address_line,
    maps_url,
    salon_latitude: salon ? String(salon.lat) : String(d.salon_latitude ?? ""),
    salon_longitude: salon ? String(salon.lng) : String(d.salon_longitude ?? ""),
    gender: String(d.gender ?? ""),
    service_blob: blob,
    service_item_pretty,
    booking_date: String(d.booking_date ?? ""),
    stylist_id: String(d.stylist_id ?? ""),
    stylist_name,
    slot_id: String(d.slot_id ?? ""),
    review_summary: ""
  };

  row.review_summary = [
    `Hi ${row.customer_name}, please review your selections below. ✨`,
    "",
    `Salon: ${row.salon_name}`,
    row.salon_address_line ? `Address: ${row.salon_address_line}` : "",
    `Services: ${row.service_item_pretty}`,
    `Date: ${row.booking_date}`,
    `Time: ${row.slot_id}`,
    `Stylist: ${row.stylist_name}`
  ]
    .filter(Boolean)
    .join("\n");

  return row;
}

export async function handleFlowDataExchange(reqBody) {
  const action = reqBody.action;
  const screen = reqBody.screen;
  const flowToken = reqBody.flow_token || "default";
  const data = reqBody.data || {};
  const session = getSession(flowToken);
  const act = normAction(action);
  console.log("[flow] inbound", {
    action: act,
    screen: screen || "init",
    dataKeys: Object.keys(data || {})
  });

  const v = { version: "3.0" };

  if (act === "ping") {
    return { ...v, data: { status: "active" } };
  }

  if (act === "init") {
    const initData = { ...session, ...data };
    console.log(
      `[flow:init] token=${flowToken} data_name=${Boolean(data.customer_name)} session_name=${Boolean(
        session.customer_name
      )} data_mobile=${Boolean(data.customer_mobile)} session_mobile=${Boolean(session.customer_mobile)}`
    );
    return {
      ...v,
      screen: "ENTRY",
      data: {
        customer_name: initData.customer_name || "",
        customer_mobile: initData.customer_mobile || "",
        customer_email: initData.customer_email || "",
        gender_options: getGenderRadioOptions(),
        salon_id: initData.salon_id || "",
        salon_name: initData.salon_name || "",
        salon_address_line: initData.salon_address_line || "",
        maps_url: initData.maps_url || "",
        salon_latitude: initData.salon_latitude || "",
        salon_longitude: initData.salon_longitude || "",
        min_booking_date: todayIsoDate()
      }
    };
  }

  if (screen === "ENTRY" && act === "data_exchange") {
    const sal = getSalonByIdFromCache(data.salon_id);
    const salon_name = sal?.name || data.salon_name || "";
    const maps_url = sal?.mapsUrl || data.maps_url || "";
    Object.assign(session, {
      customer_name: data.customer_name,
      customer_mobile: data.customer_mobile,
      customer_email: data.customer_email || "",
      gender: data.gender,
      salon_id: data.salon_id,
      salon_name,
      salon_address_line: data.salon_address_line || "",
      maps_url,
      service_blob: ""
    });
    setFlowSession(flowToken, session);

    return {
      ...v,
      screen: "CATEGORY",
      data: {
        customer_name: data.customer_name,
        customer_mobile: data.customer_mobile,
        customer_email: data.customer_email || "",
        gender: data.gender,
        salon_id: data.salon_id,
        salon_name,
        salon_address_line: data.salon_address_line || "",
        maps_url,
        salon_latitude:
          sal && sal.lat != null ? String(sal.lat) : String(data.salon_latitude || ""),
        salon_longitude:
          sal && sal.lng != null ? String(sal.lng) : String(data.salon_longitude || ""),
        service_blob: "",
        category_options: await safeCategoryOptionsForGender(data.gender)
      }
    };
  }

  if (screen === "CATEGORY" && act === "data_exchange") {
    const merged = { ...session, ...data };
    const categories = await safeCategoryOptionsForGender(merged.gender);
    const selectedRaw = data.selected_categories;
    let selectedIds = [];
    if (Array.isArray(selectedRaw)) {
      selectedIds = selectedRaw.map((v) => String(v || "").trim()).filter(Boolean);
    } else if (typeof selectedRaw === "string" && selectedRaw.trim()) {
      // Some flow runtimes serialize array-like values as comma-separated strings.
      selectedIds = selectedRaw
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    } else {
      // Backward compatibility with older form payloads.
      selectedIds = [
        data.category_id,
        data.additional_category_id,
        data.additional_category_id_2,
        data.additional_category_id_3,
        data.additional_category_id_4,
        data.additional_category_id_5,
        data.additional_category_id_6
      ]
        .map((v) => String(v || "").trim())
        .filter(Boolean);
    }

    let newBlob = merged.service_blob || "";
    const seen = new Set();
    for (const id of selectedIds) {
      const match = categories.find((c) => String(c.id) === id);
      if (!match || seen.has(String(match.id))) continue;
      seen.add(String(match.id));
      newBlob = appendServiceBlob(newBlob, `${match.id}||${match.title}`);
    }
    const services_pretty = formatServicesPrettyFromBlob(newBlob);
    const sal = getSalonByIdFromCache(merged.salon_id);
    let stylistList = [];
    try {
      stylistList = await getStylistsByGender(merged.salon_id, merged.gender, merged.booking_date);
    } catch (err) {
      console.warn("[flow] getStylistsByGender failed, using fallback", err.message);
    }
    const nextSession = mergeAndSaveSession(flowToken, session, {
      ...merged,
        selected_categories: selectedIds,
      service_blob: newBlob,
      services_pretty
    });

    return {
      ...v,
      screen: "DATE_STYLIST",
      data: {
        customer_name: nextSession.customer_name,
        customer_mobile: nextSession.customer_mobile,
        customer_email: nextSession.customer_email || "",
        gender: nextSession.gender,
        salon_id: nextSession.salon_id,
        salon_name: sal?.name || nextSession.salon_name || "",
        salon_address_line: nextSession.salon_address_line || "",
        maps_url: sal?.mapsUrl || nextSession.maps_url || "",
        salon_latitude: sal ? String(sal.lat) : nextSession.salon_latitude || "",
        salon_longitude: sal ? String(sal.lng) : nextSession.salon_longitude || "",
        service_blob: newBlob,
        services_pretty,
        min_booking_date: todayIsoDate(),
        stylist_options: stylistList.map((s) => ({ id: s.id, title: s.displayTitle || s.name }))
      }
    };
  }

  if (screen === "DATE_STYLIST" && act === "data_exchange") {
    const merged = { ...session, ...data };
    if (isPastDate(merged.booking_date)) {
      const reloadedStylists = await getStylistsByGender(merged.salon_id, merged.gender, todayIsoDate());
      return {
        ...v,
        screen: "DATE_STYLIST",
        data: {
          ...merged,
          min_booking_date: todayIsoDate(),
          booking_date: todayIsoDate(),
          stylist_options: reloadedStylists.map((s) => ({ id: s.id, title: s.displayTitle || s.name }))
        }
      };
    }
    const sal = getSalonByIdFromCache(merged.salon_id);
    const stylist_name = await stylistDisplayName(merged.salon_id, merged.stylist_id, merged.gender);
    const slots = await fetchSlots({
      storeId: merged.salon_id,
      aptDate: merged.booking_date,
      empId: merged.stylist_id
    });
    const filteredSlots = filterSlotsFromCurrentTime(slots, merged.booking_date);

    const nextSession = mergeAndSaveSession(flowToken, session, {
      ...merged,
      salon_name: sal?.name || merged.salon_name,
      salon_address_line: merged.salon_address_line || "",
      maps_url: sal?.mapsUrl || merged.maps_url
    });

    return {
      ...v,
      screen: "SLOT",
      data: {
        customer_name: nextSession.customer_name,
        customer_mobile: nextSession.customer_mobile,
        customer_email: nextSession.customer_email || "",
        gender: nextSession.gender,
        salon_id: nextSession.salon_id,
        salon_name: sal?.name || nextSession.salon_name || "",
        salon_address_line: nextSession.salon_address_line || "",
        maps_url: sal?.mapsUrl || nextSession.maps_url || "",
        salon_latitude: sal ? String(sal.lat) : nextSession.salon_latitude || "",
        salon_longitude: sal ? String(sal.lng) : nextSession.salon_longitude || "",
        service_blob: nextSession.service_blob || "",
        services_pretty: formatServicesPrettyFromBlob(nextSession.service_blob || ""),
        booking_date: nextSession.booking_date,
        stylist_id: nextSession.stylist_id,
        stylist_name,
        slot_options: filteredSlots
      }
    };
  }

  if (screen === "SLOT" && act === "data_exchange") {
    const reviewData = await buildReviewScreenData(data, session);
    mergeAndSaveSession(flowToken, session, reviewData);

    return {
      ...v,
      screen: "REVIEW",
      data: reviewData
    };
  }

  if (screen === "REVIEW" && act === "complete") {
    const d = { ...session, ...data };
    const selectedSalon =
      getSalonByIdFromCache(d.salon_id) ||
      (session.salons || []).find((s) => s.id === d.salon_id);
    const resolvedStylist = d.stylist_name || (await stylistDisplayName(d.salon_id, d.stylist_id, d.gender));

    const parts = parseServiceBlobParts(d.service_blob);
    const primary = parts[0] ? parseServiceOptionId(parts[0]) : { service_category: "", service_item: "" };

    const booking = createPendingBooking({
      fullName: d.customer_name,
      mobile: d.customer_mobile,
      email: d.customer_email || "",
      salonId: d.salon_id,
      salonName: selectedSalon?.name || d.salon_name || d.salon_id,
      mapsUrl: selectedSalon?.mapsUrl || d.maps_url || "",
      gender: d.gender,
      serviceCategory: primary.service_category || d.service_category || "Multiple",
      serviceItem: formatServicesPrettyFromBlob(d.service_blob) || d.service_item_pretty,
      serviceBlob: d.service_blob,
      date: d.booking_date,
      stylistName: resolvedStylist,
      timeSlot: d.slot_id
    });

    mergeAndSaveSession(flowToken, session, { ...d, lastBooking: booking });
    await insertBooking(booking);
    try {
      const addToCalendarPayload = {
        storeid: Number(d.salon_id),
        orgid: config.gtlOrgId,
        name: d.customer_name,
        email: d.customer_email || "",
        mobile: d.customer_mobile,
        genderid: String(d.gender || "").toLowerCase() === "male" ? 1 : 2,
        notes: "Booked via WhatsApp",
        service: formatServicesPrettyFromBlob(d.service_blob) || d.service_item_pretty || "",
        selectedDate: d.booking_date,
        time: normalizeTimeForApi(d.slot_id),
        id: String(d.stylist_id || "")
      };
      console.log("[flow] addToCalendar request payload", addToCalendarPayload);
      const addToCalendarResponse = await createAppointment(addToCalendarPayload);
      console.log("[flow] addToCalendar success response", addToCalendarResponse);
    } catch (error) {
      console.warn("[flow] addToCalendar failed", error.message);
    }
    return {
      ...v,
      data: {
        booking_id: booking.bookingId,
        booking_status: booking.status
      }
    };
  }

  console.warn("[flow] unhandled", { action, screen, dataKeys: Object.keys(data) });
  return { ...v, data: {} };
}

export function getSessionByFlowToken(flowToken) {
  return getFlowSession(flowToken);
}
