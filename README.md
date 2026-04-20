# Green Trends WhatsApp Chatbot (Phase 1)

This project provides a **WhatsApp-first booking flow** that mirrors the Green Trends web journey:

1. Customer details  
2. Location (pincode or lat/long)  
3. Nearest salon selection  
4. Gender  
5. Service category and service item  
6. Date  
7. Stylist preference (with **No Preference**)  
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

- `src/bookingEngine.js` + `src/mockData.js`  
  Phase 1 business logic and mock salon/service data.

- `src/whatsapp.js`  
  WhatsApp Cloud API senders for text, image, interactive flow, and confirmation.

---

## Setup

1. Install dependencies:
   - `npm install`
2. Create env:
   - Copy `.env.example` to `.env`
   - Fill all values
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

## Notes for Production Hardening

- Add signature validation using `APP_SECRET`.
- Persistence now uses MySQL tables: `salons`, `users`, and `appointments`.
- Chennai salon branches are seeded into `salons` automatically on first startup when the table is empty.
- Local JSON state file is still used for `onboarding` and `flowSessions` (`./data/state.json` by default, configurable via `DB_STATE_PATH`).
- Debug endpoints available: `GET /internal/users`, `GET /internal/appointments`, and `GET /internal/bookings`.
- Set MySQL envs: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
- Replace mock availability with real-time inventory engine.
- Add approved media assets (brand banners) hosted on CDN.
- Add language personalization (English/Tamil) if needed for promotions.

---

## Geocode salon coordinates

To improve nearest-salon ranking accuracy, geocode all salon addresses into `salons.lat/lng`.

1. Ensure MySQL envs are set in `.env` (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`).
2. Run:
   - `npm run geocode-salons`
3. Optional tuning envs:
   - `GEOCODE_FORCE=true` (re-geocode all rows)
   - `GEOCODE_LIMIT=20` (process first 20)
   - `GEOCODE_DELAY_MS=1200` (request spacing for API friendliness)
