/**
 * Geocode salon addresses and persist lat/lng into MySQL `salons` table.
 *
 * Usage:
 *   npm run geocode-salons
 *
 * Optional env:
 *   GEOCODE_FORCE=true        # re-geocode rows even if lat/lng already present
 *   GEOCODE_LIMIT=20          # process first N salons
 *   GEOCODE_DELAY_MS=1200     # delay between requests (Nominatim-friendly)
 *   GEOCODE_USER_AGENT=...    # custom User-Agent string
 */
import axios from "axios";
import dotenv from "dotenv";
import mysql from "mysql2/promise";

dotenv.config();

const host = process.env.DB_HOST || "127.0.0.1";
const port = Number(process.env.DB_PORT || 3306);
const user = process.env.DB_USER || "root";
const password = process.env.DB_PASSWORD || "";
const database = process.env.DB_NAME || "green_trends";

const force = String(process.env.GEOCODE_FORCE || "").toLowerCase() === "true";
const delayMs = Number(process.env.GEOCODE_DELAY_MS || 1200);
const limit = Number(process.env.GEOCODE_LIMIT || 0);
const userAgent =
  process.env.GEOCODE_USER_AGENT || "green-trends-salon-bot/1.0 (contact: local-dev)";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeAddress(value) {
  return String(value || "")
    .replace(/\b(opp\.?|opposite|near|nr|above|beside|next to)\b[^,]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,+/g, ",")
    .replace(/^,|,$/g, "")
    .trim();
}

function trimBrandNoise(name) {
  return String(name || "")
    .replace(/green\s*trends/gi, "")
    .replace(/unisex|hair|style|salon|beauty/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[-,\s]+|[-,\s]+$/g, "")
    .trim();
}

function buildQueries(row) {
  const address = sanitizeAddress(row.address_line1);
  const area = String(row.area || "").trim();
  const city = String(row.city || "").trim() || "Chennai";
  const state = String(row.state || "").trim() || "Tamil Nadu";
  const pincode = String(row.pincode || "").trim();
  const trimmedName = trimBrandNoise(row.name);

  const queries = [
    [address, area, city, pincode, state, "India"],
    [trimmedName, address, city, pincode, state, "India"],
    [trimmedName || area, city, pincode, state, "India"],
    [area || trimmedName, city, state, "India"],
    [pincode, city, state, "India"]
  ]
    .map((parts) => parts.filter(Boolean).join(", "))
    .filter(Boolean);

  return [...new Set(queries)];
}

async function geocode(query) {
  const url = "https://nominatim.openstreetmap.org/search";
  const { data } = await axios.get(url, {
    params: {
      q: query,
      format: "jsonv2",
      limit: 1,
      countrycodes: "in"
    },
    headers: {
      "User-Agent": userAgent
    },
    timeout: 20000
  });

  const first = Array.isArray(data) ? data[0] : null;
  if (!first?.lat || !first?.lon) return null;

  return {
    lat: Number(first.lat),
    lng: Number(first.lon),
    displayName: first.display_name || ""
  };
}

const pool = mysql.createPool({
  host,
  port,
  user,
  password,
  database,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0
});

try {
  const whereClause = force ? "" : "WHERE lat IS NULL OR lng IS NULL";
  const limitClause = Number.isFinite(limit) && limit > 0 ? `LIMIT ${Math.floor(limit)}` : "";

  const [rows] = await pool.query(`
    SELECT id, name, address_line1, area, city, state, pincode, lat, lng
    FROM salons
    ${whereClause}
    ORDER BY id ASC
    ${limitClause}
  `);

  if (!rows.length) {
    console.log("No salons require geocoding.");
    process.exit(0);
  }

  console.log(`Starting geocoding for ${rows.length} salons...`);

  let success = 0;
  let failed = 0;

  for (const row of rows) {
    const queries = buildQueries(row);
    try {
      let result = null;
      let matchedQuery = "";
      for (const query of queries) {
        result = await geocode(query);
        if (result) {
          matchedQuery = query;
          break;
        }
      }

      if (!result) {
        failed += 1;
        console.log(`MISS  ${row.id} | tried=${queries.length}`);
      } else {
        await pool.execute(
          `
            UPDATE salons
            SET lat = ?, lng = ?, maps_url = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [result.lat, result.lng, `https://maps.google.com/?q=${result.lat},${result.lng}`, row.id]
        );
        success += 1;
        console.log(`OK    ${row.id} | ${result.lat}, ${result.lng} | q=${matchedQuery}`);
      }
    } catch (error) {
      failed += 1;
      console.log(`ERROR ${row.id} | ${error.message}`);
    }

    await sleep(delayMs);
  }

  console.log(`Done. Success=${success}, Failed=${failed}, Total=${rows.length}`);
} finally {
  await pool.end();
}
