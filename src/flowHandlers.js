import {
  appendServiceBlob,
  createPendingBooking,
  formatServicesPrettyFromBlob,
  getAvailableSlots,
  getCategoryOptionsForGender,
  getGenderRadioOptions,
  getServiceOptionsForGenderCategory,
  getStylistsByGender,
  parseServiceBlobParts,
  parseServiceOptionId
} from "./bookingEngine.js";
import { getFlowSession, getSalonById, insertBooking, setFlowSession } from "./database.js";

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

const addMoreOptions = () => [
  { id: "yes", title: "Yes — add another service ➕" },
  { id: "no", title: "No — continue ✓" }
];

async function buildReviewScreenData(incoming, session) {
  const d = { ...session, ...incoming };
  const salon = await getSalonById(d.salon_id);
  const blob = String(d.service_blob || "");
  const service_item_pretty =
    formatServicesPrettyFromBlob(blob) || String(d.service_item_pretty || "");

  let stylist_name = "";
  if (!d.stylist_id || d.stylist_id === "none") {
    stylist_name = "No Preference";
  } else {
    stylist_name =
      (await stylistDisplayName(d.salon_id, d.stylist_id, d.gender)) || String(d.stylist_name || "");
  }

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
        salon_longitude: initData.salon_longitude || ""
      }
    };
  }

  if (screen === "ENTRY" && act === "data_exchange") {
    const sal = await getSalonById(data.salon_id);
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
        category_options: await getCategoryOptionsForGender(data.gender)
      }
    };
  }

  if (screen === "CATEGORY" && act === "data_exchange") {
    const merged = { ...session, ...data };
    const nextSession = mergeAndSaveSession(flowToken, session, {
      ...merged,
      category_id: data.category_id
    });

    return {
      ...v,
      screen: "SERVICE_PICK",
      data: {
        customer_name: nextSession.customer_name,
        customer_mobile: nextSession.customer_mobile,
        customer_email: nextSession.customer_email || "",
        gender: nextSession.gender,
        salon_id: nextSession.salon_id,
        salon_name: nextSession.salon_name,
        salon_address_line: nextSession.salon_address_line || "",
        maps_url: nextSession.maps_url,
        salon_latitude: nextSession.salon_latitude,
        salon_longitude: nextSession.salon_longitude,
        service_blob: nextSession.service_blob || "",
        category_id: data.category_id,
        service_options: await getServiceOptionsForGenderCategory(
          nextSession.gender,
          data.category_id
        )
      }
    };
  }

  if (screen === "SERVICE_PICK" && act === "data_exchange") {
    const merged = { ...session, ...data };
    const newBlob = appendServiceBlob(merged.service_blob, data.service_item);
    const services_pretty = formatServicesPrettyFromBlob(newBlob);
    const nextSession = mergeAndSaveSession(flowToken, session, {
      ...merged,
      service_blob: newBlob,
      services_pretty
    });

    return {
      ...v,
      screen: "MORE_SERVICES",
      data: {
        customer_name: nextSession.customer_name,
        customer_mobile: nextSession.customer_mobile,
        customer_email: nextSession.customer_email || "",
        gender: nextSession.gender,
        salon_id: nextSession.salon_id,
        salon_name: nextSession.salon_name,
        salon_address_line: nextSession.salon_address_line || "",
        maps_url: nextSession.maps_url,
        salon_latitude: nextSession.salon_latitude,
        salon_longitude: nextSession.salon_longitude,
        service_blob: newBlob,
        services_pretty,
        add_more_options: addMoreOptions()
      }
    };
  }

  if (screen === "MORE_SERVICES" && act === "data_exchange") {
    const merged = { ...session, ...data };
    const nextSession = mergeAndSaveSession(flowToken, session, merged);

    if (nextSession.add_more === "yes") {
      return {
        ...v,
        screen: "CATEGORY",
        data: {
          customer_name: nextSession.customer_name,
          customer_mobile: nextSession.customer_mobile,
          customer_email: nextSession.customer_email || "",
          gender: nextSession.gender,
          salon_id: nextSession.salon_id,
          salon_name: nextSession.salon_name,
          salon_address_line: nextSession.salon_address_line || "",
          maps_url: nextSession.maps_url,
          salon_latitude: nextSession.salon_latitude,
          salon_longitude: nextSession.salon_longitude,
          service_blob: nextSession.service_blob || "",
          category_options: await getCategoryOptionsForGender(nextSession.gender)
        }
      };
    }

    const sal = await getSalonById(nextSession.salon_id);
    const stylistList = await getStylistsByGender(nextSession.salon_id, nextSession.gender);
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
        service_blob: nextSession.service_blob || "",
        services_pretty: formatServicesPrettyFromBlob(nextSession.service_blob || ""),
        stylist_options: stylistList.map((s) => ({ id: s.id, title: s.name }))
      }
    };
  }

  if (screen === "DATE_STYLIST" && act === "data_exchange") {
    const merged = { ...session, ...data };
    const sal = await getSalonById(merged.salon_id);
    const slots = getAvailableSlots({
      date: merged.booking_date,
      openHours: sal?.openHours
    });
    const stylist_name =
      !merged.stylist_id || merged.stylist_id === "none"
        ? "No Preference"
        : await stylistDisplayName(merged.salon_id, merged.stylist_id, merged.gender);

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
        slot_options: slots.map((slot) => ({ id: slot, title: slot }))
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
      (await getSalonById(d.salon_id)) ||
      (session.salons || []).find((s) => s.id === d.salon_id);
    const resolvedStylist =
      !d.stylist_id || d.stylist_id === "none"
        ? "No Preference"
        : d.stylist_name || (await stylistDisplayName(d.salon_id, d.stylist_id, d.gender));

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
