# Green Trends WhatsApp Chatbot (Phase 1)

This project provides a **WhatsApp-first booking flow** that mirrors the Green Trends web journey:

1. Customer details  
2. Location (pincode or lat/long)  
3. Nearest salon selection  
4. Gender  
5. Service category  
6. Add additional categories (optional)  
7. Date + stylist preference (with **No Preference**)  
8. Slot selection  
9. Confirmation

POS integration is intentionally skipped for now, as requested.

---

## Included

- `whatsapp-flows/green-trends-phase1-booking-flow.json`  
  Ready-to-import WhatsApp Flow JSON with multi-screen forms and data bindings.

- `src/server.js`  
  Webhook server for inbound messages, flow launch, and flow data exchange.

- `src/flowHandlers.js`  
  Dynamic data provider for salons, categories, services, stylists, and slots.

- `src/bookingEngine.js` + `src/gtlApi.js`  
  Booking logic and external GTL API integration (store/category/stylist/slot/booking).

- `src/whatsapp.js`  
  WhatsApp Cloud API senders for text, image, interactive flow, and confirmation.

---

## Setup

1. Install dependencies:
   - `npm install`
2. Create env:
   - Copy `.env.example` to `.env`
   - Fill all values (WhatsApp + GTL API settings)
3. Start server:
   - `npm run dev`
4. Configure Meta webhook:
   - Verify URL: `GET /webhook`
   - Message webhook: `POST /webhook`
5. Configure Flow data endpoint:
   - `POST /flow/data-exchange`

---

## WhatsApp User Experience

When user says **Hi** (or comes from Meta ads click-to-WhatsApp):

1. Bot sends an image welcome message.
2. Bot sends a short journey preview text.
3. Bot sends an interactive **Flow CTA** (`Book Appointment`).
4. User completes all form screens inside WhatsApp.
5. Booking is created as `PENDING_APPROVAL`.
6. Internal approval callback (`/internal/mock-approve`) sends final confirmation format:
   - `Your booking is confirmed for [Date] at [Time] with [Stylist Name] at [Location Name]. Location Link: [Google Maps Link]`

If rejected, you can call `sendBookingRejected()` with alternate slot options.

---

## GTL API Configuration

The booking flow is API-first and uses GTL endpoints for search + booking.

- `GTL_API_BASE_URL` (default: `https://gtlvl.innosmarti.com`)
- `GTL_ORG_ID` (default: `1001`)
- `GTL_BRAND_ID` (default: `1`)
- `GTL_API_COOKIE` (optional, but often required in practice for session-backed APIs)

APIs wired in code:

- `POST /api/storedetailsforapt` (lat/long and pincode variants)
- `POST /api/getappointmentcategory`
- `POST /api/getemployeeforappointment`
- `POST /api/getemployeeforappointmentslot`
- `POST /api/addToCalendar`

## Notes for Production Hardening

- Add signature validation using `APP_SECRET`.
- Booking/search/category/stylist/slot data is fetched from GTL APIs.
- Local runtime storage is in-memory for onboarding/flow sessions/fallback booking visibility.
- Add durable persistence if historical reporting is required across restarts.
- Debug endpoints available: `GET /internal/users`, `GET /internal/appointments`, and `GET /internal/bookings`.
- Keep `GTL_API_COOKIE` fresh if upstream enforces session cookies.
- Add approved media assets (brand banners) hosted on CDN.
- Add language personalization (English/Tamil) if needed for promotions.
