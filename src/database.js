const EMPTY_STATE = { onboarding: {}, flowSessions: {}, bookings: [] };
let stateCache = structuredClone(EMPTY_STATE);

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

export async function initDatabase() {
  stateCache = structuredClone(EMPTY_STATE);
  return "in-memory";
}

export function getOnboardingState(phoneNumber) {
  const row = stateCache.onboarding[phoneNumber];
  return row && typeof row === "object" ? { ...row } : null;
}

export function setOnboardingState(phoneNumber, onboardingState) {
  stateCache.onboarding[phoneNumber] = { ...onboardingState, updatedAt: new Date().toISOString() };
  return { ...stateCache.onboarding[phoneNumber] };
}

export function getFlowSession(flowToken) {
  const row = stateCache.flowSessions[flowToken];
  return row && typeof row === "object" ? { ...row } : {};
}

export function setFlowSession(flowToken, session) {
  stateCache.flowSessions[flowToken] = { ...session, updatedAt: new Date().toISOString() };
  return { ...stateCache.flowSessions[flowToken] };
}

export async function insertBooking(booking) {
  const now = new Date().toISOString();
  const phone = normalizePhone(booking.mobile);
  if (!phone) {
    throw new Error("mobile is required to create booking");
  }
  const toSave = {
    ...booking,
    mobile: phone,
    createdAt: booking.createdAt || now,
    updatedAt: now
  };
  const idx = stateCache.bookings.findIndex((b) => b.bookingId === booking.bookingId);
  if (idx >= 0) stateCache.bookings[idx] = toSave;
  else stateCache.bookings.unshift(toSave);
  return booking;
}

export async function listUsers() {
  const byMobile = new Map();
  for (const b of stateCache.bookings) {
    if (!b.mobile || byMobile.has(b.mobile)) continue;
    byMobile.set(b.mobile, {
      userId: byMobile.size + 1,
      fullName: b.fullName || "",
      phone: b.mobile,
      email: b.email || "",
      createdAt: b.createdAt,
      updatedAt: b.updatedAt
    });
  }
  return [...byMobile.values()];
}

export async function listAppointments() {
  return stateCache.bookings.map((b, idx) => ({
    appointmentPk: idx + 1,
    appointmentId: b.bookingId,
    userId: idx + 1,
    status: b.status,
    salonId: b.salonId,
    salonName: b.salonName,
    mapsUrl: b.mapsUrl,
    gender: b.gender,
    serviceCategory: b.serviceCategory,
    serviceItem: b.serviceItem,
    serviceBlob: b.serviceBlob,
    date: b.date,
    stylistName: b.stylistName,
    timeSlot: b.timeSlot,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt
  }));
}

export async function listBookings() {
  return [...stateCache.bookings];
}

export async function listBookingsByMobile(mobile, limit = 10) {
  const phone = normalizePhone(mobile);
  if (!phone) return [];
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 10));
  return stateCache.bookings.filter((b) => b.mobile === phone).slice(0, safeLimit);
}
