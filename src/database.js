import mysql from "mysql2/promise";
import { getSeedSalons } from "./salonSeedData.js";

const EMPTY_STATE = {
  onboarding: {},
  flowSessions: {}
};

let stateCache = structuredClone(EMPTY_STATE);
let pool = null;
let serviceCategoryTitleById = new Map();

function shouldAutoSeed() {
  const explicit = process.env.DB_SEED_ON_STARTUP;
  if (explicit != null) {
    return ["1", "true", "yes", "on"].includes(String(explicit).trim().toLowerCase());
  }
  return String(process.env.NODE_ENV || "").toLowerCase() !== "production";
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

function loadState() {
  return stateCache;
}

function saveState() {
  // In-memory chat/session state only.
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
    CREATE TABLE IF NOT EXISTS services (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      gender VARCHAR(20) NOT NULL,
      category_id VARCHAR(80) NOT NULL,
      category_title VARCHAR(120) NOT NULL,
      service_name VARCHAR(120) NOT NULL,
      service_description VARCHAR(255) NOT NULL DEFAULT '',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_services_gender_service (gender, service_name),
      KEY idx_services_gender_category (gender, category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS stylists (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      salon_id VARCHAR(120) NOT NULL,
      gender VARCHAR(20) NOT NULL,
      stylist_name VARCHAR(120) NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_stylists_salon_gender_name (salon_id, gender, stylist_name),
      KEY idx_stylists_salon_gender (salon_id, gender)
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

  if (shouldAutoSeed()) {
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

    const serviceSeed = [
      ["male", "Bleach", "Skin lightening"],
      ["male", "Clean up", "Basic skin cleansing"],
      ["male", "Detan", "Tan removal"],
      ["male", "Facial", "Skin glow, hydration"],
      ["male", "Hair Colouring", "Coloring, grey coverage"],
      ["male", "Hair Spa", "Deep conditioning, shine"],
      ["male", "Hair Treatment", "Hair fall, dandruff care"],
      ["male", "Haircut", "Cuts, styling"],
      ["male", "Head Massage", "Relaxing scalp massage"],
      ["male", "Manicure", "Hand grooming, nails"],
      ["male", "Party Makeup", "Makeup for events"],
      ["male", "Pedicure", "Foot care, nails"],
      ["female", "Bleach", "Skin lightening"],
      ["female", "Clean up", "Basic skin cleansing"],
      ["female", "Detan", "Tan removal"],
      ["female", "Facial", "Skin glow, hydration"],
      ["female", "Hair Colouring", "Coloring, highlights"],
      ["female", "Hair Smoothening", "Straightening, shine"],
      ["female", "Hair Spa", "Deep conditioning, shine"],
      ["female", "Hair Treatment", "Hair fall, dandruff care"],
      ["female", "Haircut", "Cuts, styling"],
      ["female", "Hairdo - Basic", "Basic hair styling"],
      ["female", "Head Massage", "Relaxing scalp massage"],
      ["female", "Manicure", "Hand grooming, nails"],
      ["female", "Party Makeup", "Makeup for events"],
      ["female", "Pedicure", "Foot care, nails"],
      ["female", "Saree Draping", "Professional draping"],
      ["female", "Threading", "Eyebrow & face shaping"],
      ["female", "Trial Hairdo", "Trial hair styling"],
      ["female", "Trial Makeup", "Trial session"],
      ["female", "Waxing", "Hair removal"]
    ];

    for (const [gender, title, description] of serviceSeed) {
      const categoryId = `${gender}_${title}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 80);
      await db.execute(
        `
          INSERT INTO services (gender, category_id, category_title, service_name, service_description)
          VALUES (?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            category_id = VALUES(category_id),
            category_title = VALUES(category_title),
            service_description = VALUES(service_description)
        `,
        [gender, categoryId, title, title, description]
      );
    }

    const maleStylists = ["Arun", "Karthik", "Praveen", "Rohit", "Vikram", "Suresh", "Naveen", "Ajay"];
    const femaleStylists = ["Priya", "Divya", "Anitha", "Keerthana", "Nandhini", "Shalini", "Meera", "Swathi"];
    let idx = 0;
    for (const salon of seedRows) {
      for (const [gender, names] of [
        ["male", maleStylists],
        ["female", femaleStylists]
      ]) {
        for (let i = 0; i < 4; i += 1) {
          const name = names[(idx + i) % names.length];
          await db.execute(
            `
              INSERT INTO stylists (salon_id, gender, stylist_name, is_active)
              VALUES (?, ?, ?, 1)
              ON DUPLICATE KEY UPDATE is_active = 1
            `,
            [salon.id, gender, name]
          );
        }
        idx += 1;
      }
    }
  }

  const [categoryRows] = await db.execute(
    "SELECT category_id, category_title FROM services GROUP BY category_id, category_title"
  );
  serviceCategoryTitleById = new Map(categoryRows.map((r) => [r.category_id, r.category_title]));
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

export async function initDatabase() {
  await ensureSchema();
  stateCache = structuredClone(EMPTY_STATE);
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
  const phone = normalizePhone(booking.mobile);
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

export async function listBookingsByMobile(mobile, limit = 10) {
  const phone = normalizePhone(mobile);
  if (!phone) return [];
  const safeLimit = Math.max(1, Math.min(20, Number(limit) || 10));

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
      WHERE u.phone = ?
      ORDER BY a.created_at DESC
      LIMIT ${safeLimit}
    `,
    [phone]
  );

  return rows.map((row) => ({
    ...row,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  }));
}

export async function listServiceCategoriesByGender(gender) {
  const g = String(gender || "").toLowerCase();
  const db = getPool();
  const [rows] = await db.execute(
    `
      SELECT category_id AS id, category_title AS title
      FROM services
      WHERE gender = ?
      GROUP BY category_id, category_title
      ORDER BY category_title ASC
    `,
    [g]
  );
  return rows;
}

export async function listServicesByGenderCategory(gender, categoryId) {
  const g = String(gender || "").toLowerCase();
  const c = String(categoryId || "").trim();
  const db = getPool();
  const [rows] = await db.execute(
    `
      SELECT service_name, service_description
      FROM services
      WHERE gender = ? AND category_id = ?
      ORDER BY service_name ASC
    `,
    [g, c]
  );
  return rows.map((r) => ({
    id: `${c}||${r.service_name}`,
    title: r.service_description ? `${r.service_name} — ${r.service_description}` : r.service_name
  }));
}

export function getServiceCategoryTitleById(categoryId) {
  return serviceCategoryTitleById.get(String(categoryId || "").trim()) || String(categoryId || "");
}

export async function listStylistsBySalonGender(salonId, gender) {
  const sid = String(salonId || "").trim();
  const g = String(gender || "").toLowerCase();
  if (!sid) return [{ id: "none", name: "No Preference" }];
  const db = getPool();
  const [rows] = await db.execute(
    `
      SELECT id, stylist_name
      FROM stylists
      WHERE salon_id = ? AND is_active = 1 AND (gender = ? OR gender = 'any')
      ORDER BY stylist_name ASC
    `,
    [sid, g]
  );
  return [
    { id: "none", name: "No Preference" },
    ...rows.map((r) => ({ id: `sty_${r.id}`, name: r.stylist_name }))
  ];
}
