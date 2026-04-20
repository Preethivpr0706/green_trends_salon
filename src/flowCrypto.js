import crypto from "crypto";
import fs from "fs";

/**
 * WhatsApp Flow endpoint encryption (data_api_version 3.0).
 * @see https://developers.facebook.com/docs/whatsapp/flows/guides/implementingyourflowendpoint
 */

export function loadFlowPrivateKeyPem() {
  const path = process.env.FLOW_PRIVATE_KEY_PATH;
  if (path && fs.existsSync(path)) {
    return fs.readFileSync(path, "utf8");
  }
  const inline = process.env.FLOW_PRIVATE_KEY;
  if (inline) {
    return inline.replace(/\\n/g, "\n");
  }
  return null;
}

export function decryptFlowRequest(body, privateKeyPem) {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;
  if (!encrypted_aes_key || !encrypted_flow_data || !initial_vector) {
    throw new Error("missing_encrypted_fields");
  }

  const decryptedAesKey = crypto.privateDecrypt(
    {
      key: crypto.createPrivateKey(privateKeyPem),
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256"
    },
    Buffer.from(encrypted_aes_key, "base64")
  );

  const flowDataBuffer = Buffer.from(encrypted_flow_data, "base64");
  const initialVectorBuffer = Buffer.from(initial_vector, "base64");

  const TAG_LENGTH = 16;
  const encryptedFlowDataBody = flowDataBuffer.subarray(0, -TAG_LENGTH);
  const encryptedFlowDataTag = flowDataBuffer.subarray(-TAG_LENGTH);

  const decipher = crypto.createDecipheriv(
    "aes-128-gcm",
    decryptedAesKey,
    initialVectorBuffer
  );
  decipher.setAuthTag(encryptedFlowDataTag);

  const decryptedJSONString = Buffer.concat([
    decipher.update(encryptedFlowDataBody),
    decipher.final()
  ]).toString("utf-8");

  return {
    decryptedBody: JSON.parse(decryptedJSONString),
    aesKeyBuffer: decryptedAesKey,
    initialVectorBuffer
  };
}

export function encryptFlowResponse(responseObject, aesKeyBuffer, initialVectorBuffer) {
  const flippedIv = Buffer.alloc(initialVectorBuffer.length);
  for (let i = 0; i < initialVectorBuffer.length; i++) {
    flippedIv[i] = initialVectorBuffer[i] ^ 0xff;
  }

  const cipher = crypto.createCipheriv("aes-128-gcm", aesKeyBuffer, flippedIv);
  return Buffer.concat([
    cipher.update(JSON.stringify(responseObject), "utf-8"),
    cipher.final(),
    cipher.getAuthTag()
  ]).toString("base64");
}
