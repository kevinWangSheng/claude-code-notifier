/**
 * Generic webhook channel
 * Follows Standard Webhooks spec where possible:
 * https://github.com/standard-webhooks/standard-webhooks
 *
 * Auth: optional HMAC-SHA256 signature in webhook-signature header
 */

const crypto = require("node:crypto");

async function send(channelConfig, message) {
  const { webhook_url, secret, headers: extraHeaders = {} } = channelConfig;
  if (!webhook_url) throw new Error("webhook: webhook_url is required");

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const msgId = `msg_${crypto.randomUUID()}`;

  const payload = {
    type: `claude_code.${message.event}`,
    timestamp: new Date().toISOString(),
    data: {
      title: message.title,
      status: message.status,
      project: message.project || null,
      branch: message.branch || null,
      host: message.host || null,
      duration: message.duration || null,
      summary: message.summary || null,
      event: message.event,
      session_id: message.session_id || null,
    },
  };

  const bodyStr = JSON.stringify(payload);
  const headers = {
    "Content-Type": "application/json",
    "webhook-id": msgId,
    "webhook-timestamp": timestamp,
    ...extraHeaders,
  };

  // Add signature if secret is configured
  if (secret) {
    const content = `${msgId}.${timestamp}.${bodyStr}`;
    const sig = crypto
      .createHmac("sha256", secret)
      .update(content)
      .digest("base64");
    headers["webhook-signature"] = `v1,${sig}`;
  }

  const resp = await fetch(webhook_url, {
    method: "POST",
    headers,
    body: bodyStr,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`webhook: HTTP ${resp.status} - ${text}`);
  }

  return { status: resp.status };
}

module.exports = { send };
