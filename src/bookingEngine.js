import {
  genderRadioOptions,
  getCategoryTitleById,
  listCategoriesForGender,
  listServiceOptionsForCategory
} from "./serviceCatalog.js";
import { getAllSalons } from "./database.js";

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
export function getNearestSalons({ pincode, lat, lng }) {
  return getNearestSalonsAsync({ pincode, lat, lng });
}

export async function getNearestSalonsAsync({ pincode, lat, lng }) {
  const salons = await getAllSalons();
  if (!salons.length) return [];

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
  return genderRadioOptions;
}

export function getCategoryOptionsForGender(gender) {
  return listCategoriesForGender(gender);
}

export function getServiceOptionsForGenderCategory(gender, categoryId) {
  return listServiceOptionsForCategory(gender, categoryId);
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
      const catTitle = getCategoryTitleById(service_category);
      return service_item ? `${catTitle} — ${service_item}` : catTitle;
    })
    .join("; ");
}

export function parseServiceOptionId(id) {
  if (!id || typeof id !== "string") {
    return { service_category: "", service_item: "" };
  }
  const idx = id.indexOf("||");
  if (idx === -1) return { service_category: "", service_item: id };
  return {
    service_category: id.slice(0, idx),
    service_item: id.slice(idx + 2)
  };
}

export function getStylists(salonId) {
  return getStylistsByGender(salonId, "any");
}

const MALE_STYLIST_NAMES = [
  "Arun",
  "Karthik",
  "Praveen",
  "Rohit",
  "Vikram",
  "Suresh",
  "Naveen",
  "Ajay",
  "Rahul",
  "Harish"
];

const FEMALE_STYLIST_NAMES = [
  "Priya",
  "Divya",
  "Anitha",
  "Keerthana",
  "Nandhini",
  "Shalini",
  "Meera",
  "Swathi",
  "Aishwarya",
  "Lavanya"
];

const stylistCache = new Map();

function hashString(value) {
  let h = 0;
  const s = String(value || "");
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

function seededShuffle(list, seedValue) {
  const arr = [...list];
  let seed = hashString(seedValue);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const j = seed % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function getStylistsByGender(salonId, gender = "any") {
  const sid = String(salonId || "").trim();
  if (!sid) {
    return [{ id: "none", name: "No Preference" }];
  }

  const normalizedGender = String(gender || "any").toLowerCase();
  const key = `${sid}::${normalizedGender}`;
  if (stylistCache.has(key)) {
    return stylistCache.get(key);
  }

  let baseNames = [...MALE_STYLIST_NAMES, ...FEMALE_STYLIST_NAMES];
  if (normalizedGender === "male" || normalizedGender === "men") {
    baseNames = MALE_STYLIST_NAMES;
  } else if (normalizedGender === "female" || normalizedGender === "women") {
    baseNames = FEMALE_STYLIST_NAMES;
  }

  const chosen = seededShuffle(baseNames, key).slice(0, 4).map((name, idx) => ({
    id: `${sid}_${normalizedGender}_stylist_${idx + 1}`,
    name
  }));

  const result = [{ id: "none", name: "No Preference" }, ...chosen];
  stylistCache.set(key, result);
  return result;
}

/** WhatsApp list row: title max 24, description max 72 characters. */
export function truncateSalonListTitle(name, max = 24) {
  const n = String(name || "");
  if (n.length <= max) return n;
  if (max <= 3) return n.slice(0, max);
  return `${n.slice(0, max - 3)}...`;
}

export function formatSalonListDescription(s) {
  const bits = [s.area, s.city, s.pincode].filter(Boolean);
  let line = bits.join(" | ");
  if (s.distanceKm != null) line = `${line} | ~${s.distanceKm} km`.trim();
  if (!line) {
    line = [s.city, s.pincode].filter(Boolean).join(" | ");
  }
  if (line.length > 72) return `${line.slice(0, 69)}...`;
  return line;
}

export function getAvailableSlots({ date }) {
  // Mocked availability for Phase 1 without POS sync.
  const all = [
    "11:00 AM",
    "11:15 AM",
    "11:30 AM",
    "12:00 PM",
    "12:15 PM",
    "12:30 PM",
    "01:00 PM",
    "01:15 PM",
    "02:00 PM",
    "02:30 PM",
    "03:00 PM",
    "03:30 PM",
    "04:00 PM",
    "04:30 PM",
    "05:00 PM",
    "05:30 PM",
    "06:00 PM",
    "06:30 PM",
    "06:45 PM"
  ];

  // Small deterministic variation by date string.
  const skipIndex = (date || "").length % 4;
  return all.filter((_, idx) => idx % 4 !== skipIndex);
}

export function createPendingBooking(payload) {
  const now = new Date().toISOString();
  const bookingId = `GT-${Date.now()}`;
  return {
    bookingId,
    status: "PENDING_APPROVAL",
    createdAt: now,
    updatedAt: now,
    ...payload
  };
}
