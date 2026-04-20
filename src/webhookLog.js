const prefix = "[webhook]";

export function logWebhook(step, detail, extra) {
  const line = extra !== undefined ? `${prefix} ${step} | ${detail} | ${JSON.stringify(extra)}` : `${prefix} ${step} | ${detail}`;
  console.log(line);
}

export function logWebhookError(step, err) {
  const msg = err?.message || String(err);
  console.error(`${prefix} ERROR ${step} | ${msg}`);
}
