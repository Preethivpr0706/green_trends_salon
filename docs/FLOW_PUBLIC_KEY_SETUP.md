# WhatsApp Flow: public key & encrypted endpoint

Meta requires a **2048-bit RSA key pair** for Flow endpoints: you upload the **public** key to Meta (it is “signed” as part of that process), and your server keeps the **private** key to **decrypt** incoming Flow requests and **encrypt** responses.

Official guide: [Implementing Endpoint for Flows](https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint/) (see **Upload Public Key** and **Request Decryption and Encryption**).

## 1. Generate a key pair

### Option A — Node (no OpenSSL; works on Windows)

From the project root:

```bash
npm run generate-flow-keys
```

This writes `keys/flow_private.pem` and `keys/flow_public.pem`.

### Option B — OpenSSL (macOS / Linux / Git Bash)

If `openssl` is on your `PATH`:

```bash
openssl genrsa -out flow_private.pem 2048
openssl rsa -in flow_private.pem -pubout -out flow_public.pem
```

On Windows, if `openssl` is not recognized, use **Option A**, or install OpenSSL (e.g. [Win32 OpenSSL](https://slproweb.com/products/Win32OpenSSL.html)), or use **Git Bash** (often includes `openssl`).

- **Keep `flow_private.pem` secret** — never commit it to git or paste it into WhatsApp Manager.
- You will upload **`flow_public.pem`** (full PEM including `BEGIN` / `END` lines).

Store the private key on the server (path or env) as `FLOW_PRIVATE_KEY_PATH` or `FLOW_PRIVATE_KEY` (see `.env.example`).

## 2. Upload the public key (WhatsApp Cloud API)

Use your **Phone Number ID** and a **System User** token with WhatsApp permissions (same app connected to the Flow in WhatsApp Manager).

HTTP API reference: [WhatsApp Business Encryption](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/whatsapp-business-encryption/).

The official request uses **`Content-Type: application/x-www-form-urlencoded`** and includes:

- `messaging_product=whatsapp`
- `business_public_key=<full PEM string>`

### Recommended: Node script (works on Windows)

Put `WHATSAPP_TOKEN` and `PHONE_NUMBER_ID` in your `.env`, then:

```bash
npm run upload-flow-public-key
```

This reads `keys/flow_public.pem` and POSTs a correctly encoded form body (avoids multiline / quoting bugs).

### curl on Windows (common failure + fix)

In **PowerShell**, `curl` is often an alias for **`Invoke-WebRequest`**, not real curl — flags like `--data-urlencode` may not work, so Meta receives **no** `business_public_key` and returns `(#100) The parameter business_public_key is required`.

Use **`curl.exe`** explicitly and pass the key **from a file** (curl will URL-encode the file contents):

```powershell
curl.exe -X POST "https://graph.facebook.com/v25.0/<PHONE_NUMBER_ID>/whatsapp_business_encryption" `
  -H "Authorization: Bearer <ACCESS_TOKEN>" `
  -H "Content-Type: application/x-www-form-urlencoded" `
  --data-urlencode "messaging_product=whatsapp" `
  --data-urlencode "business_public_key@keys/flow_public.pem"
```

On **macOS/Linux** (bash), the same `@file` form works with `curl` (not `Invoke-WebRequest`).

After a successful upload, **WhatsApp Manager → Flow → Endpoint → Sign public key** should complete (refresh the page).

**Note:** If you have several numbers on the same WABA, Meta may require the key to be registered **per phone number** — check the encryption doc for your setup.

## 3. Point the Flow to your HTTPS URL

In **WhatsApp Manager → Flows → your flow → Endpoint**, set the URL to your encrypted route, for example:

`https://<your-domain>/flow`

This project implements **`POST /flow`**: it expects the encrypted JSON body described in Meta’s docs (`encrypted_flow_data`, `encrypted_aes_key`, `initial_vector`) and returns **base64 ciphertext** as **plain text** (`Content-Type: text/plain`).

Requirements:

- **HTTPS** with a valid TLS certificate
- Server implements **decrypt → business logic → encrypt** (see `src/flowCrypto.js` + `src/server.js`)

## 4. Health check

Meta may send **`action: "ping"`** health checks. `handleFlowDataExchange` in `src/flowHandlers.js` already responds with `{ data: { status: "active" } }` (wrapped in the usual handler output). Ensure your deployment returns **HTTP 200** for successful decrypt + encrypt.

## 5. Local plaintext testing (optional)

For local debugging only, you can set `FLOW_ALLOW_PLAINTEXT=true` and `POST` JSON directly to **`/flow/data-exchange`**. **Disable this in production** and use only **`/flow`** with encryption.

## 6. Troubleshooting

| Symptom | What to check |
|--------|----------------|
| “Sign public key” never completes | Public key not uploaded for this **Phone Number ID**, wrong token, or wrong API version/field name — compare with [WhatsApp Business Encryption](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/whatsapp-business-encryption/). |
| `421` / decrypt errors | Private key does **not** match uploaded public key, or body was altered. |
| Flow works in Builder but not on device | Endpoint must be **public HTTPS**; firewall allows Meta; response must be **encrypted** base64 string. |
| **`404` / `Cannot POST /flow`** (HTML from Express) | Your tunnel is **not** hitting this app on the correct port, or an **old Node process** without `POST /flow` is running. **Fix:** (1) In `.env`, note `PORT` (default `3000`). (2) Start the server: `node src/server.js`. (3) Start ngrok to **that same port**: `ngrok http 3000` (not 80/8080 unless the app listens there). (4) In the browser, open `https://<ngrok-host>/flow` — you should see **JSON** `{"ok":true,"service":"whatsapp-flow-endpoint",...}`. If you still get 404, the tunnel target is wrong — restart ngrok and confirm the “Forwarding” line points to `localhost:3000`. (5) Restart Node after pulling code so `POST /flow` is registered. |

### Quick check (ngrok + local server)

1. `node src/server.js` → log should say `Flow endpoint: POST http://localhost:3000/flow`.
2. `ngrok http 3000` (match your `PORT`).
3. Visit `https://<subdomain>.ngrok-free.app/flow` — expect **200** and JSON (GET health). If this 404s, Meta will also fail.
