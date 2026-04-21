import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputPath = path.join(__dirname, "bootstrap-production.full.sql");

dotenv.config();

function q(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function makeInsert(tableName, columns, rows, onDuplicateClause) {
  if (!rows.length) {
    return `-- No rows found in ${tableName}; skipped data insert.\n`;
  }

  const values = rows
    .map((row) => `(${columns.map((col) => q(row[col])).join(", ")})`)
    .join(",\n");

  return [
    `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES`,
    values,
    onDuplicateClause,
    ""
  ].join("\n");
}

async function readCurrentTableData() {
  const host = process.env.DB_HOST || "127.0.0.1";
  const port = Number(process.env.DB_PORT || 3306);
  const user = process.env.DB_USER || "root";
  const password = process.env.DB_PASSWORD || "";
  const database = process.env.DB_NAME || "green_trends";

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database
  });

  try {
    const [salons] = await conn.query(
      `SELECT id, name, address_line1, area, city, state, pincode, phone, open_hours, lat, lng, maps_url
       FROM salons
       ORDER BY id ASC`
    );
    const [services] = await conn.query(
      `SELECT gender, category_id, category_title, service_name, service_description
       FROM services
       ORDER BY gender ASC, category_id ASC, service_name ASC`
    );
    const [stylists] = await conn.query(
      `SELECT salon_id, gender, stylist_name, is_active
       FROM stylists
       ORDER BY salon_id ASC, gender ASC, stylist_name ASC`
    );

    return { salons, services, stylists };
  } finally {
    await conn.end();
  }
}

function makeSql({ salons, services, stylists }) {
  const salonInsert = makeInsert(
    "salons",
    ["id", "name", "address_line1", "area", "city", "state", "pincode", "phone", "open_hours", "lat", "lng", "maps_url"],
    salons,
    `ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  address_line1 = VALUES(address_line1),
  area = VALUES(area),
  city = VALUES(city),
  state = VALUES(state),
  pincode = VALUES(pincode),
  phone = VALUES(phone),
  open_hours = VALUES(open_hours),
  lat = VALUES(lat),
  lng = VALUES(lng),
  maps_url = VALUES(maps_url);`
  );

  const serviceInsert = makeInsert(
    "services",
    ["gender", "category_id", "category_title", "service_name", "service_description"],
    services,
    `ON DUPLICATE KEY UPDATE
  category_id = VALUES(category_id),
  category_title = VALUES(category_title),
  service_description = VALUES(service_description);`
  );

  const stylistInsert = makeInsert(
    "stylists",
    ["salon_id", "gender", "stylist_name", "is_active"],
    stylists,
    `ON DUPLICATE KEY UPDATE
  is_active = VALUES(is_active);`
  );

  return `-- Full bootstrap generated from current DB tables
-- Usage:
--   node scripts/generate-bootstrap-sql.mjs
--   mysql -u root -p < scripts/bootstrap-production.full.sql

CREATE DATABASE IF NOT EXISTS \`green_trends\`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE \`green_trends\`;

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
  KEY idx_stylists_salon_gender (salon_id, gender),
  CONSTRAINT fk_stylist_salon
    FOREIGN KEY (salon_id) REFERENCES salons(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_appointments_salon
    FOREIGN KEY (salon_id) REFERENCES salons(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

${salonInsert}
${serviceInsert}
${stylistInsert}
`;
}

async function run() {
  const tableData = await readCurrentTableData();
  const sql = makeSql(tableData);
  await fs.writeFile(outputPath, sql, "utf8");
  console.log(`Generated: ${outputPath}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
