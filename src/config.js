import dotenv from "dotenv";

dotenv.config();

function resolveWelcomeImageUrl() {
  if (process.env.WELCOME_IMAGE_URL) {
    return process.env.WELCOME_IMAGE_URL;
  }
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (base) {
    return `${base}/static/green-trends-welcome.png`;
  }
  return "https://content.jdmagicbox.com/comp/udumalpet/v9/9999p4252.4252.230829135004.w5v9/catalogue/green-trends-unisex-hair-and-style-salon-udamalpet-bazaar-udumalpet-beauty-parlours-ivopniamus.jpg";
}

export const config = {
  port: process.env.PORT || 3000,
  verifyToken: process.env.VERIFY_TOKEN || "",
  whatsappToken: process.env.WHATSAPP_TOKEN || "",
  phoneNumberId: process.env.PHONE_NUMBER_ID || "",
  flowIdBookAppointment: process.env.FLOW_ID_BOOK_APPOINTMENT || "",
  appSecret: process.env.APP_SECRET || "",
  gtlApiBaseUrl: process.env.GTL_API_BASE_URL || "https://gtlvl.innosmarti.com",
  gtlOrgId: Number(process.env.GTL_ORG_ID || 1001),
  gtlBrandId: Number(process.env.GTL_BRAND_ID || 1),
  gtlApiCookie: process.env.GTL_API_COOKIE || "",
  /** Set PUBLIC_BASE_URL (e.g. https://xxx.ngrok-free.app) so /static/green-trends-welcome.png works, or set WELCOME_IMAGE_URL. */
  get welcomeImageUrl() {
    return resolveWelcomeImageUrl();
  }
};

export function validateConfig() {
  const required = [
    "verifyToken",
    "whatsappToken",
    "phoneNumberId",
    "flowIdBookAppointment"
  ];

  const missing = required.filter((key) => !config[key]);
  if (missing.length > 0) {
    // Non-fatal for local development, but warn clearly.
    console.warn(
      `[WARN] Missing env keys: ${missing.join(", ")}. Some bot features will fail until configured.`
    );
  }
}
