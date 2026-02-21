/**
 * Bark — iOS push notifications
 * Docs: https://github.com/Finb/Bark
 *
 * Simple HTTP call → Apple APNs → iPhone notification
 * Default server: https://api.day.app
 * Self-hosted also supported.
 */

async function send(channelConfig, message) {
  const {
    device_key,
    server_url = "https://api.day.app",
  } = channelConfig;
  if (!device_key) throw new Error("bark: device_key is required");

  const url = `${server_url.replace(/\/+$/, "")}/${encodeURIComponent(device_key)}`;

  const body = {
    title: message.title,
    body: formatBody(message),
    group: "claude-code",
    icon: "https://claude.ai/favicon.ico",
    level: message.status === "warning" ? "timeSensitive" : "active",
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const result = await resp.json();
  if (result.code !== 200) {
    throw new Error(`bark: ${result.code} - ${result.message}`);
  }
  return result;
}

function formatBody(msg) {
  const parts = [];
  const l = msg.labels || {};
  if (msg.project) parts.push(`${l.project || "项目"}: ${msg.project}`);
  if (msg.branch) parts.push(`${l.branch || "分支"}: ${msg.branch}`);
  if (msg.host) parts.push(`${l.host || "机器"}: ${msg.host}`);
  if (msg.duration) parts.push(`${l.duration || "耗时"}: ${msg.duration}`);
  if (msg.summary) parts.push(`\n${msg.summary}`);
  return parts.join("\n");
}

module.exports = { send };
