/**
 * Server酱 (ServerChan) — push to WeChat via Official Account
 * Docs: https://sct.ftqq.com/
 *
 * 1. Login at sct.ftqq.com with GitHub/WeChat
 * 2. Get your SendKey
 * 3. Follow the official account to receive messages on WeChat
 */

async function send(channelConfig, message) {
  const { key, api_url } = channelConfig;
  if (!key) throw new Error("serverchan: key (SendKey) is required");

  const url = api_url || `https://sctapi.ftqq.com/${key}.send`;

  const body = new URLSearchParams({
    title: message.title,
    desp: formatDesp(message),
  });

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const result = await resp.json();
  if (result.code !== 0) {
    throw new Error(`serverchan: ${result.code} - ${result.message}`);
  }
  return result;
}

function formatDesp(msg) {
  const lines = [];

  const l = msg.labels || {};
  if (msg.project) lines.push(`**${l.project || "项目"}**: ${msg.project}`);
  if (msg.branch) lines.push(`**${l.branch || "分支"}**: ${msg.branch}`);
  if (msg.host) lines.push(`**${l.host || "机器"}**: ${msg.host}`);
  if (msg.duration) lines.push(`**${l.duration || "耗时"}**: ${msg.duration}`);

  if (lines.length > 0) lines.push("");

  if (msg.summary) lines.push(msg.summary);

  return lines.join("\n\n");
}

module.exports = { send };
