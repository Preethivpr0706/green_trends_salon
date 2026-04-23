import {
  fetchCategoriesForGender,
  fetchStoresByLocation,
  fetchStoresByPincode,
  fetchStoresBySearchText,
  fetchStylists,
  getSalonFromCache
} from "./gtlApi.js";

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const NEARBY_MAX = 10;
const NEARBY_MIN = 3;

function withDistance(lat, lng, s) {
  return {
    ...s,
    distanceKm: Number(distanceKm(lat, lng, s.lat, s.lng).toFixed(1))
  };
}

function sortByDistanceFrom(lat, lng, list) {
  return [...list]
    .map((s) => withDistance(lat, lng, s))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

function uniqueBySalonId(list) {
  const seen = new Set();
  return list.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function withNearbyBounds(primary, fallbackPool) {
  const uniquePrimary = uniqueBySalonId(primary || []);
  if (uniquePrimary.length >= NEARBY_MIN) {
    return uniquePrimary.slice(0, Math.min(NEARBY_MAX, uniquePrimary.length));
  }

  const extras = uniqueBySalonId(
    (fallbackPool || []).filter((s) => !uniquePrimary.some((p) => p.id === s.id))
  );
  const merged = uniqueBySalonId([...uniquePrimary, ...extras]);
  return merged.slice(0, Math.min(NEARBY_MAX, merged.length));
}

function rankByPincodeDistance(anchorPincode, list) {
  const anchor = Number(anchorPincode);
  return [...(list || [])]
    .map((s) => {
      const pin = Number(s.pincode);
      const pinDistance = Number.isNaN(anchor) || Number.isNaN(pin) ? Number.MAX_SAFE_INTEGER : Math.abs(pin - anchor);
      return { ...s, pinDistance };
    })
    .sort((a, b) => a.pinDistance - b.pinDistance);
}

/**
 * 3–10 nearby salons (fewer only if your catalogue has fewer salons).
 * Pincode: no matches → []. GPS: all salons ranked by distance.
 */
export function getNearestSalons({ pincode, searchText, lat, lng }) {
  return getNearestSalonsAsync({ pincode, searchText, lat, lng });
}

export async function getNearestSalonsAsync({ pincode, searchText, lat, lng }) {
  let salons = [];
  const hasSearchText = searchText != null && String(searchText).trim() !== "";
  if (searchText != null && String(searchText).trim() !== "") {
    salons = await fetchStoresBySearchText(searchText);
  } else if (pincode != null && String(pincode).trim() !== "") {
    salons = await fetchStoresByPincode(pincode);
  } else if (lat != null && lng != null) {
    salons = await fetchStoresByLocation({ lat, lng });
  }
  if (!salons.length) return [];

  if (hasSearchText) {
    return withNearbyBounds(salons, salons);
  }

  if (pincode != null && String(pincode).trim() !== "") {
    const p = String(pincode).trim();
    const direct = salons.filter((s) => s.pincode === p);
    if (direct.length === 0) return [];
    const anchor = direct.find((s) => s.lat != null && s.lng != null) || direct[0];
    if (anchor.lat == null || anchor.lng == null) {
      const cityPool = rankByPincodeDistance(
        p,
        salons.filter(
          (s) => s.city && anchor.city && s.city.toLowerCase() === anchor.city.toLowerCase()
        )
      );
      return withNearbyBounds(
        rankByPincodeDistance(p, direct),
        cityPool
      );
    }
    const withCoords = salons.filter((s) => s.lat != null && s.lng != null);
    const ranked = sortByDistanceFrom(anchor.lat, anchor.lng, withCoords);
    const cityPool = rankByPincodeDistance(
      p,
      salons.filter(
        (s) => s.city && anchor.city && s.city.toLowerCase() === anchor.city.toLowerCase()
      )
    );
    return withNearbyBounds(ranked, cityPool);
  }

  if (
    lat != null &&
    lng != null &&
    !Number.isNaN(Number(lat)) &&
    !Number.isNaN(Number(lng))
  ) {
    const la = Number(lat);
    const ln = Number(lng);
    const withCoords = salons.filter((s) => s.lat != null && s.lng != null);
    const ranked = sortByDistanceFrom(la, ln, withCoords);
    return withNearbyBounds(ranked, salons);
  }

  return [];
}

export function getGenderRadioOptions() {
  return [
    { id: "male", title: "Male" },
    { id: "female", title: "Female" }
  ];
}

export async function getCategoryOptionsForGender(gender) {
  return fetchCategoriesForGender(gender);
}

const BLOB_SEP = "###";

/** Append one `categoryId||serviceTitle` pick to the running blob. */
export function appendServiceBlob(blob, serviceOptionId) {
  const part = String(serviceOptionId || "").trim();
  if (!part) return blob || "";
  const cur = String(blob || "").trim();
  return cur ? `${cur}${BLOB_SEP}${part}` : part;
}

export function parseServiceBlobParts(blob) {
  const raw = String(blob || "").trim();
  if (!raw) return [];
  return raw.split(BLOB_SEP).filter(Boolean);
}

/** Human-readable list for UI / review. */
export function formatServicesPrettyFromBlob(blob) {
  const parts = parseServiceBlobParts(blob);
  if (parts.length === 0) return "";
  return parts
    .map((p) => {
      const { service_category, service_item } = parseServiceOptionId(p);
      return service_item || service_category;
    })
    .join("; ");
}

export function parseServiceOptionId(id) {
  if (!id || typeof id !== "string") {
    return { service_category: "", service_item: "" };
  }
  const idx = id.indexOf("||");
  if (idx === -1) return { service_category: id, service_item: id };
  return {
    service_category: id.slice(0, idx),
    service_item: id.slice(idx + 2)
  };
}

export async function getStylistsByGender(salonId, gender = "any", aptDate) {
  return fetchStylists({
    storeId: salonId,
    aptDate: aptDate || new Date().toISOString().slice(0, 10),
    gender
  });
}

export function getSalonByIdFromCache(salonId) {
  return getSalonFromCache(salonId) || null;
}

/** WhatsApp list row: title max 24, description max 72 characters. */
export function truncateSalonListTitle(name, max = 24) {
  const n = String(name || "");
  if (n.length <= max) return n;
  if (max <= 3) return n.slice(0, max);
  return `${n.slice(0, max - 3)}...`;
}

export function formatSalonListDescription(s) {
  const bits = [s.city, s.pincode].filter(Boolean);
  let line = bits.join(" | ");
  if (s.distanceKm != null) line = `${line} | ~${s.distanceKm} km`.trim();
  if (!line) {
    line = [s.city, s.pincode].filter(Boolean).join(" | ");
  }
  if (line.length > 72) return `${line.slice(0, 69)}...`;
  return line;
}

export function getSalonListTitle(s) {
  const area = String(s?.area || "").trim();
  if (area) return truncateSalonListTitle(area);
  return truncateSalonListTitle(s?.name || "Green Trends");
}

export function getAvailableSlots({ date, openHours }) {
  return getAvailableSlotsByOpenHours({ date, openHours });
}

function timeStringToMinutes(value) {
  const m = String(value || "")
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

function minutesToTimeString(totalMinutes) {
  const mins = ((totalMinutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(mins / 60);
  const minute = mins % 60;
  const meridiem = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const mm = String(minute).padStart(2, "0");
  return `${String(hour12).padStart(2, "0")}:${mm} ${meridiem}`;
}

function parseOpenHoursRange(openHours) {
  const text = String(openHours || "").trim();
  if (!text.includes("-")) return null;
  const parts = text.split("-").map((p) => p.trim());
  if (parts.length !== 2) return null;
  const start = timeStringToMinutes(parts[0]);
  const end = timeStringToMinutes(parts[1]);
  if (start == null || end == null) return null;
  return { start, end };
}

export function getAvailableSlotsByOpenHours({ date, openHours, stepMinutes = 30 }) {
  const parsed = parseOpenHoursRange(openHours);
  if (!parsed) {
    // Fallback if open hours are unavailable.
    return ["10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM"];
  }

  const { start, end } = parsed;
  if (end <= start) {
    return [];
  }

  const all = [];
  for (let cur = start; cur <= end - stepMinutes; cur += stepMinutes) {
    all.push(minutesToTimeString(cur));
  }

  // Keep deterministic thinning to simulate unavailable slots while preserving 30-min cadence.
  const skipIndex = (String(date || "").length + start + end) % 4;
  return all.filter((_, idx) => idx % 4 !== skipIndex);
}

export function createPendingBooking(payload) {
  const now = new Date().toISOString();
  const bookingId = `BK${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
  return {
    bookingId,
    status: "PENDING_APPROVAL",
    createdAt: now,
    updatedAt: now,
    ...payload
  };
}
