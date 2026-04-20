import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";
import { getSeedSalons } from "./salonSeedData.js";

const DEFAULT_STATE_PATH = "./data/state.json";
const EMPTY_STATE = {
  onboarding: {},
  flowSessions: {}
};

let stateCache = null;
let resolvedStatePath = null;
let pool = null;

function getStatePath() {
  if (resolvedStatePath) return resolvedStatePath;
  const configured = process.env.DB_STATE_PATH || DEFAULT_STATE_PATH;
  resolvedStatePath = path.resolve(process.cwd(), configured);
  return resolvedStatePath;
}

function ensureParentDirectory(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function loadState() {
  if (stateCache) return stateCache;

  const statePath = getStatePath();
  ensureParentDirectory(statePath);

  if (!fs.existsSync(statePath)) {
    stateCache = structuredClone(EMPTY_STATE);
    fs.writeFileSync(statePath, JSON.stringify(stateCache, null, 2), "utf8");
    return stateCache;
  }

  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = raw ? JSON.parse(raw) : {};
    stateCache = {
      onboarding: parsed.onboarding && typeof parsed.onboarding === "object" ? parsed.onboarding : {},
      flowSessions:
        parsed.flowSessions && typeof parsed.flowSessions === "object" ? parsed.flowSessions : {}
    };
  } catch (error) {
    console.warn(`[db] Failed to read state file, resetting: ${error.message}`);
    stateCache = structuredClone(EMPTY_STATE);
    fs.writeFileSync(statePath, JSON.stringify(stateCache, null, 2), "utf8");
  }

  return stateCache;
}

function saveState() {
  const statePath = getStatePath();
  ensureParentDirectory(statePath);
  fs.writeFileSync(statePath, JSON.stringify(loadState(), null, 2), "utf8");
}

function getPool() {
  if (pool) return pool;

  const host = process.env.DB_HOST || "127.0.0.1";
  const port = Number(process.env.DB_PORT || 3306);
  const user = process.env.DB_USER || "root";
  const password = process.env.DB_PASSWORD || "";
  const database = process.env.DB_NAME || "green_trends";

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  return pool;
}

async function ensureSchema() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS salons (
      id VARCHAR(120) NOT NULL,
      name VARCHAR(255) NOT NULL,
      address_line1 VARCHAR(500) NOT NULL DEFAULT '',
      area VARCHAR(200) NOT NULL DEFAULT '',
      city VARCHAR(120) NOT NULL DEFAULT '',
      state VARCHAR(120) NOT NULL DEFAULT '',
      pincode VARCHAR(10) NOT NULL DEFAULT '',
      phone VARCHAR(20) NOT NULL DEFAULT '',
      open_hours VARCHAR(80) NOT NULL DEFAULT '',
      lat DECIMAL(10,7) NULL,
      lng DECIMAL(10,7) NULL,
      maps_url VARCHAR(700) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_salons_pincode (pincode),
      KEY idx_salons_city (city)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      full_name VARCHAR(120) NOT NULL DEFAULT '',
      phone VARCHAR(20) NOT NULL,
      email VARCHAR(180) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_users_phone (phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      booking_id VARCHAR(60) NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'PENDING_APPROVAL',
      salon_id VARCHAR(120) NOT NULL DEFAULT '',
      salon_name VARCHAR(255) NOT NULL DEFAULT '',
      maps_url VARCHAR(500) NOT NULL DEFAULT '',
      gender VARCHAR(40) NOT NULL DEFAULT '',
      service_category VARCHAR(120) NOT NULL DEFAULT '',
      service_item TEXT,
      service_blob TEXT,
      booking_date VARCHAR(30) NOT NULL DEFAULT '',
      stylist_name VARCHAR(120) NOT NULL DEFAULT '',
      time_slot VARCHAR(40) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_appointments_booking_id (booking_id),
      KEY idx_appointments_user_id (user_id),
      CONSTRAINT fk_appointments_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  const seedRows = getSeedSalons();
  for (const row of seedRows) {
    await db.execute(
      `
        INSERT INTO salons
        (id, name, address_line1, area, city, state, pincode, phone, open_hours, lat, lng, maps_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          name = VALUES(name),
          address_line1 = VALUES(address_line1),
          area = VALUES(area),
          city = VALUES(city),
          state = VALUES(state),
          pincode = VALUES(pincode),
          phone = VALUES(phone),
          open_hours = VALUES(open_hours),
          maps_url = VALUES(maps_url)
      `,
      [
        row.id,
        row.name,
        row.addressLine1 || "",
        row.area || "",
        row.city || "",
        row.state || "",
        row.pincode || "",
        row.phone || "",
        row.openHours || "",
        row.lat,
        row.lng,
        row.mapsUrl || ""
      ]
    );
  }
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

export async function initDatabase() {
  await ensureSchema();
  loadState();
  const host = process.env.DB_HOST || "127.0.0.1";
  const port = Number(process.env.DB_PORT || 3306);
  const database = process.env.DB_NAME || "green_trends";
  return `mysql://${host}:${port}/${database}`;
}

export function getOnboardingState(phoneNumber) {
  const state = loadState();
  const row = state.onboarding[phoneNumber];
  return row && typeof row === "object" ? { ...row } : null;
}

export function setOnboardingState(phoneNumber, onboardingState) {
  const state = loadState();
  state.onboarding[phoneNumber] = { ...onboardingState, updatedAt: new Date().toISOString() };
  saveState();
  return { ...state.onboarding[phoneNumber] };
}

export function getFlowSession(flowToken) {
  const state = loadState();
  const row = state.flowSessions[flowToken];
  return row && typeof row === "object" ? { ...row } : {};
}

export function setFlowSession(flowToken, session) {
  const state = loadState();
  state.flowSessions[flowToken] = { ...session, updatedAt: new Date().toISOString() };
  saveState();
  return { ...state.flowSessions[flowToken] };
}

export async function insertBooking(booking) {
  const db = getPool();
  const now = new Date();
  const phone = String(booking.mobile || "").trim();
  if (!phone) {
    throw new Error("mobile is required to create booking");
  }

  await db.execute(
    `
      INSERT INTO users (full_name, phone, email, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        full_name = VALUES(full_name),
        email = VALUES(email),
        updated_at = VALUES(updated_at)
    `,
    [booking.fullName || "", phone, booking.email || "", now, now]
  );

  const [userRows] = await db.execute("SELECT id FROM users WHERE phone = ? LIMIT 1", [phone]);
  const userId = userRows?.[0]?.id;
  if (!userId) {
    throw new Error(`could not resolve user for phone=${phone}`);
  }

  await db.execute(
    `
      INSERT INTO appointments
      (
        booking_id, user_id, status, salon_id, salon_name, maps_url, gender,
        service_category, service_item, service_blob, booking_date, stylist_name, time_slot,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        salon_id = VALUES(salon_id),
        salon_name = VALUES(salon_name),
        maps_url = VALUES(maps_url),
        gender = VALUES(gender),
        service_category = VALUES(service_category),
        service_item = VALUES(service_item),
        service_blob = VALUES(service_blob),
        booking_date = VALUES(booking_date),
        stylist_name = VALUES(stylist_name),
        time_slot = VALUES(time_slot),
        updated_at = VALUES(updated_at)
    `,
    [
      booking.bookingId,
      userId,
      booking.status || "PENDING_APPROVAL",
      booking.salonId || "",
      booking.salonName || "",
      booking.mapsUrl || "",
      booking.gender || "",
      booking.serviceCategory || "",
      booking.serviceItem || "",
      booking.serviceBlob || "",
      booking.date || "",
      booking.stylistName || "",
      booking.timeSlot || "",
      booking.createdAt ? new Date(booking.createdAt) : now,
      now
    ]
  );

  return booking;
}

export async function listUsers() {
  const db = getPool();
  const [rows] = await db.execute(
    `
      SELECT
        id AS userId,
        full_name AS fullName,
        phone,
        email,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM users
      ORDER BY id DESC
    `
  );

  return rows.map((row) => ({
    ...row,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  }));
}

export async function getAllSalons() {
  const db = getPool();
  const [rows] = await db.execute(
    `
      SELECT
        id,
        name,
        address_line1 AS addressLine1,
        area,
        city,
        state,
        pincode,
        phone,
        open_hours AS openHours,
        lat,
        lng,
        maps_url AS mapsUrl
      FROM salons
      ORDER BY name ASC
    `
  );
  return rows.map((row) => ({
    ...row,
    lat: row.lat == null ? null : Number(row.lat),
    lng: row.lng == null ? null : Number(row.lng)
  }));
}

export async function getSalonById(salonId) {
  const db = getPool();
  const [rows] = await db.execute(
    `
      SELECT
        id,
        name,
        address_line1 AS addressLine1,
        area,
        city,
        state,
        pincode,
        phone,
        open_hours AS openHours,
        lat,
        lng,
        maps_url AS mapsUrl
      FROM salons
      WHERE id = ?
      LIMIT 1
    `,
    [salonId]
  );
  const row = rows?.[0];
  if (!row) return null;
  return {
    ...row,
    lat: row.lat == null ? null : Number(row.lat),
    lng: row.lng == null ? null : Number(row.lng)
  };
}

export async function listAppointments() {
  const db = getPool();
  const [rows] = await db.execute(
    `
      SELECT
        id AS appointmentPk,
        booking_id AS appointmentId,
        user_id AS userId,
        status,
        salon_id AS salonId,
        salon_name AS salonName,
        maps_url AS mapsUrl,
        gender,
        service_category AS serviceCategory,
        service_item AS serviceItem,
        service_blob AS serviceBlob,
        booking_date AS date,
        stylist_name AS stylistName,
        time_slot AS timeSlot,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM appointments
      ORDER BY id DESC
    `
  );

  return rows.map((row) => ({
    ...row,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  }));
}

export async function listBookings() {
  const db = getPool();
  const [rows] = await db.execute(
    `
      SELECT
        a.booking_id AS bookingId,
        a.status,
        u.full_name AS fullName,
        u.phone AS mobile,
        u.email,
        a.salon_id AS salonId,
        a.salon_name AS salonName,
        a.maps_url AS mapsUrl,
        a.gender,
        a.service_category AS serviceCategory,
        a.service_item AS serviceItem,
        a.service_blob AS serviceBlob,
        a.booking_date AS date,
        a.stylist_name AS stylistName,
        a.time_slot AS timeSlot,
        a.created_at AS createdAt,
        a.updated_at AS updatedAt
      FROM appointments a
      INNER JOIN users u ON u.id = a.user_id
      ORDER BY a.id DESC
    `
  );

  return rows.map((row) => ({
    ...row,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  }));
}
