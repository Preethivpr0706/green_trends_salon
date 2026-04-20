export const salons = [
  {
    id: "salon_korattur",
    name: "Green Trends - Korattur",
    area: "Korattur, Chennai",
    state: "Tamil Nadu",
    city: "Chennai",
    pincode: "600080",
    lat: 13.1139,
    lng: 80.1856,
    mapsUrl: "https://maps.google.com/?q=13.1139,80.1856"
  },
  {
    id: "salon_adyar",
    name: "Green Trends - Adyar",
    area: "Adyar, Chennai",
    state: "Tamil Nadu",
    city: "Chennai",
    pincode: "600020",
    lat: 13.0012,
    lng: 80.2565,
    mapsUrl: "https://maps.google.com/?q=13.0012,80.2565"
  },
  {
    id: "salon_tnagar",
    name: "Green Trends - T Nagar",
    area: "T Nagar, Chennai",
    state: "Tamil Nadu",
    city: "Chennai",
    pincode: "600017",
    lat: 13.0418,
    lng: 80.2331,
    mapsUrl: "https://maps.google.com/?q=13.0418,80.2331"
  }
];

export const servicesByGender = {
  male: ["Haircut", "Hair Color", "Grooming", "Packages"],
  female: ["Haircut", "Hair Color", "Skin", "Grooming", "Packages"],
  kids: ["Haircut", "Grooming"]
};

export const serviceItemsByCategory = {
  Haircut: ["Classic Cut", "Advanced Styling Cut"],
  "Hair Color": ["Global Color", "Root Touchup", "Highlights"],
  Skin: ["Cleanup", "Facial"],
  Grooming: ["Beard Trim", "Shave", "Threading"],
  Packages: ["Bridal Prep", "Festive Glow", "Groom Special"]
};

export const stylistsBySalon = {
  salon_korattur: [
    { id: "none", name: "No Preference" },
    { id: "st_tamil", name: "Tamilarasi" },
    { id: "st_parv", name: "Parvathy G" },
    { id: "st_reena", name: "Reena S" }
  ],
  salon_adyar: [
    { id: "none", name: "No Preference" },
    { id: "st_akhil", name: "Akhil" },
    { id: "st_divya", name: "Divya" }
  ],
  salon_tnagar: [
    { id: "none", name: "No Preference" },
    { id: "st_karth", name: "Karthik" },
    { id: "st_priya", name: "Priyanka" }
  ]
};

export function getSalonById(id) {
  return salons.find((s) => s.id === id) || null;
}

export function mapSalonsToOptions(salonList) {
  return salonList.map((salon) => ({
    id: salon.id,
    title: salon.name,
    description: `${salon.area}${salon.distanceKm != null ? ` • ${salon.distanceKm} km` : ""}`
  }));
}

/** WhatsApp list row: title max 24, description max 72 characters. */
export function truncateSalonListTitle(name, max = 24) {
  const n = String(name || "");
  return n.length > max ? `${n.slice(0, Math.max(0, max - 1))}…` : n;
}

export function formatSalonListDescription(s) {
  const bits = [s.area, s.city, s.pincode].filter(Boolean);
  let line = bits.join(" · ");
  if (s.distanceKm != null) line = `${line} · ~${s.distanceKm} km`.trim();
  if (line.length > 72) return `${line.slice(0, 69)}…`;
  return line;
}
