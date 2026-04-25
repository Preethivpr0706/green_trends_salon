import { config } from "./config.js";

const DEFAULT_HEADERS = {
  Accept: "*/*",
  "Content-Type": "application/json",
  Origin: "https://gtlvl.innosmarti.com",
  Referer: "https://gtlvl.innosmarti.com/booking/"
};

const salonCache = new Map();

function toGenderId(gender) {
  return String(gender || "").toLowerCase() === "male" ? 1 : 2;
}

function apiUrl(path) {
  return `${config.gtlApiBaseUrl.replace(/\/$/, "")}${path}`;
}

function decodeBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeSalon(row) {
  const id = String(row?.StoreID ?? row?.StoreId ?? row?.id ?? "").trim();
  if (!id) return null;

  const lat = Number(row?.Latitude ?? row?.lat ?? row?.latitude);
  const lng = Number(row?.Longitude ?? row?.lng ?? row?.longitude);
  const storeName = String(row?.StoreName ?? row?.name ?? "").trim();
  const areaFromName = storeName.includes("-") ? storeName.split("-").slice(1).join("-").trim() : "";
  const addressText = String(row?.Address ?? row?.AddressLine1 ?? "").trim();
  const cityMatch = addressText.match(/,\s*([A-Za-z\s]+)\s*-\s*\d{6}\b/);
  const pinMatch = addressText.match(/\b(\d{6})\b/);
  const area = String(row?.Area ?? row?.Locality ?? row?.Location ?? areaFromName).trim();
  const city = String(row?.City ?? cityMatch?.[1] ?? "").trim().toUpperCase();
  const pincode = String(row?.Pincode ?? row?.ZipCode ?? pinMatch?.[1] ?? "").trim();
  const name = String(row?.StoreName ?? row?.name ?? `Green Trends - ${area || city || id}`).trim();
  const addressLine1 = String(addressText || [area, city, pincode].filter(Boolean).join(", ")).trim();
  const distanceKmRaw = Number(row?.DistanceKM ?? row?.distanceKm ?? row?.distance);

  return {
    id,
    name,
    area,
    city,
    pincode,
    addressLine1,
    mapsUrl: String(row?.mapsUrl ?? row?.MapURL ?? "").trim(),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    distanceKm: Number.isFinite(distanceKmRaw) ? Number(distanceKmRaw.toFixed(2)) : null
  };
}

async function postJson(path, payload) {
  const headers = { ...DEFAULT_HEADERS };
  if (config.gtlApiCookie) headers.Cookie = config.gtlApiCookie;

  if (
    path === "/api/storedetailsforapt" ||
    path === "/api/getemployeeforappointment" ||
    path === "/api/getappointmentcategory" ||
    path === "/api/addToCalendar"
  ) {
    console.log(`[gtlApi] request ${path}`, JSON.stringify(payload));
  }

  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const raw = await response.text();
  const parsed = decodeBody(raw);
  if (
    path === "/api/storedetailsforapt" ||
    path === "/api/getemployeeforappointment" ||
    path === "/api/getappointmentcategory" ||
    path === "/api/addToCalendar"
  ) {
    console.log(`[gtlApi] response ${path} status=`, response.status);
    console.log(`[gtlApi] response ${path} body=`, raw.slice(0, 4000));
  }
  if (!response.ok) {
    throw new Error(`API ${path} failed (${response.status}): ${raw.slice(0, 300)}`);
  }
  return parsed;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export async function fetchStoresByLocation({ lat, lng }) {
  const rows = asArray(
    await postJson("/api/storedetailsforapt", {
      latitude: Number(lat),
      longitude: Number(lng),
      orgid: config.gtlOrgId,
      brandid: config.gtlBrandId
    })
  );
  const salons = rows.map(normalizeSalon).filter(Boolean);
  console.log("[gtlApi] normalized salons (location) count=", salons.length);
  salons.forEach((s) => salonCache.set(s.id, s));
  return salons;
}

export async function fetchStoresByPincode(pincode) {
  const rows = asArray(
    await postJson("/api/storedetailsforapt", {
      searchtext: String(pincode || "").trim(),
      orgid: config.gtlOrgId,
      brandid: config.gtlBrandId
    })
  );
  const salons = rows.map(normalizeSalon).filter(Boolean);
  console.log("[gtlApi] normalized salons (searchtext) count=", salons.length);
  salons.forEach((s) => salonCache.set(s.id, s));
  return salons;
}

export async function fetchStoresBySearchText(searchText) {
  return fetchStoresByPincode(searchText);
}

export async function fetchCategoriesForGender(gender) {
  const rows = asArray(await postJson("/api/getappointmentcategory", { OrganisationID: config.gtlOrgId }));
  const gid = toGenderId(gender);
  const mapped = rows
    .filter((r) => {
      const rg = Number(r?.GenderID ?? r?.genderid ?? r?.Gender);
      return !Number.isFinite(rg) || rg === gid;
    })
    .map((r) => {
      const title = String(
        r?.AptCategory ??
          r?.Category ??
          r?.CategoryName ??
          r?.categoryname ??
          r?.title ??
          r?.text ??
          r?.ServiceCategory ??
          ""
      ).trim();
      let id = String(
        r?.AptCategoryID ?? r?.CategoryID ?? r?.categoryid ?? r?.id ?? r?.value ?? ""
      ).trim();
      if (!id && title) {
        id = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      }
      return id && title ? { id, title } : null;
    })
    .filter(Boolean);
  console.log("[gtlApi] normalized categories count=", mapped.length);
  return mapped;
}

export async function fetchStylists({ storeId, aptDate, gender }) {
  const rows = asArray(
    await postJson("/api/getemployeeforappointment", {
      StoreID: Number(storeId),
      OrganisationID: config.gtlOrgId,
      AptDate: aptDate,
      GenderID: toGenderId(gender)
    })
  );
  console.log("[gtlApi] stylists", rows);
  return rows
    .map((r) => {
      const id = String(r?.EmpID ?? r?.empid ?? r?.id ?? "").trim();
      const name = String(r?.Employee ?? r?.FirstName ?? r?.text ?? "").trim();
      const designation = String(r?.DesignationName ?? r?.designation ?? "").trim();
      const displayTitle = designation ? `${name} — ${designation}` : name;
      return id && name ? { id, name, designation, displayTitle } : null;
    })
    .filter(Boolean);
}

function formatTimeSlot(start, end) {
  const s = String(start || "").trim();
  const e = String(end || "").trim();
  if (!s) return "";
  return e ? `${s} - ${e}` : s;
}

function time24ToMinutes(value) {
  const m = String(value || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function minutesToTime12(total) {
  const hh24 = Math.floor(total / 60);
  const mm = total % 60;
  const ampm = hh24 >= 12 ? "PM" : "AM";
  const hh12 = hh24 % 12 === 0 ? 12 : hh24 % 12;
  return `${String(hh12).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${ampm}`;
}

export async function fetchSlots({ storeId, aptDate, empId }) {
  const raw = await postJson("/api/getemployeeforappointmentslot", {
    StoreID: Number(storeId),
    OrganisationID: config.gtlOrgId,
    AptDate: aptDate,
    EmpID: String(empId || "")
  });
  console.log("[gtlApi] slot raw response", raw);
  const rows = asArray(raw);

  const exact = rows
    .map((r) => formatTimeSlot(r?.starttime, r?.endtime))
    .filter(Boolean)
    .map((id) => ({ id, title: id }));
  if (exact.length) return exact;

  // Support response shape: { slots: [], start: "09:00", end: "21:00" }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const rangeStart = time24ToMinutes(raw.start);
    const rangeEnd = time24ToMinutes(raw.end);
    if (rangeStart != null && rangeEnd != null && rangeEnd > rangeStart) {
      const generated = [];
      for (let cur = rangeStart; cur <= rangeEnd - 30; cur += 30) {
        const label = minutesToTime12(cur);
        generated.push({ id: label, title: label });
      }
      if (generated.length) return generated;
    }
  }

  // Fallback to 30-min cadence if upstream does not provide slots.
  const fallback = [];
  for (let h = 10; h < 20; h += 1) {
    for (const mm of ["00", "30"]) {
      const d = new Date();
      d.setHours(h, Number(mm), 0, 0);
      const title = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
      fallback.push({ id: title, title });
    }
  }
  return fallback;
}

export async function createAppointment(payload) {
  const response = await postJson("/api/addToCalendar", payload);
  const result = String(response?.result || response?.status || "").toLowerCase();
  if (result === "error") {
    const message = String(response?.message || "unknown addToCalendar error");
    throw new Error(`addToCalendar rejected: ${message}`);
  }
  return response;
}

export function getSalonFromCache(salonId) {
  return salonCache.get(String(salonId || ""));
}
