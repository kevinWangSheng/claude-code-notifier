/**
 * DingTalk (钉钉) custom robot webhook
 * Docs: https://open.dingtalk.com/document/group/custom-robot-access
 *
 * Auth: optional HMAC-SHA256 signature in URL query params
 * Signature: HMAC-SHA256(secret, timestamp + "\n" + secret), base64 + URL-encode
 * Timestamp unit: milliseconds
 * Rate limit: 20 msgs/min (exceeding triggers 10-min ban)
 * Max payload: 20 KB
 */

const crypto = require("node:crypto");

async function send(channelConfig, message) {
  const { webhook_url, secret } = channelConfig;
  if (!webhook_url) throw new Error("dingtalk: webhook_url is required");

  let url = webhook_url;

  // Add signature if secret is configured
  if (secret) {
    const timestamp = Date.now().toString();
    const stringToSign = `${timestamp}\n${secret}`;
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(stringToSign);
    const sign = encodeURIComponent(hmac.digest("base64"));
    const sep = url.includes("?") ? "&" : "?";
    url = `${url}${sep}timestamp=${timestamp}&sign=${sign}`;
  }

  const body = {
    msgtype: "actionCard",
    actionCard: {
      title: message.title,
      text: formatActionCardText(message),
      btnOrientation: "0",
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=utf-8" },
    body: JSON.stringify(body),
  });

  const result = await resp.json();
  if (result.errcode !== 0) {
    throw new Error(`dingtalk: ${result.errcode} - ${result.errmsg}`);
  }
  return result;
}

function formatActionCardText(msg) {
  const lines = [];
  lines.push(`### ${msg.title}`);
  lines.push("");

  const l = msg.labels || {};
  if (msg.project) lines.push(`> **${l.project || "项目"}**: ${msg.project}`);
  if (msg.branch) lines.push(`> **${l.branch || "分支"}**: ${msg.branch}`);
  if (msg.host) lines.push(`> **${l.host || "机器"}**: ${msg.host}`);
  if (msg.duration) lines.push(`> **${l.duration || "耗时"}**: ${msg.duration}`);
  lines.push("");

  if (msg.summary) {
    lines.push(msg.summary);
  }

  return lines.join("\n");
}

module.exports = { send };
