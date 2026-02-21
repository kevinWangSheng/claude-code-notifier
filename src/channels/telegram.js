/**
 * Telegram Bot — send message via Bot API
 * Docs: https://core.telegram.org/bots/api#sendmessage
 *
 * 1. Create bot via @BotFather, get bot_token
 * 2. Send /start to your bot, then get chat_id via:
 *    https://api.telegram.org/bot<TOKEN>/getUpdates
 */

async function send(channelConfig, message) {
  const { bot_token, chat_id, api_url } = channelConfig;
  if (!bot_token) throw new Error("telegram: bot_token is required");
  if (!chat_id) throw new Error("telegram: chat_id is required");

  const url = api_url || `https://api.telegram.org/bot${bot_token}/sendMessage`;

  const body = {
    chat_id,
    text: formatText(message),
    parse_mode: "Markdown",
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const result = await resp.json();
  if (!result.ok) {
    throw new Error(`telegram: ${result.error_code} - ${result.description}`);
  }
  return result;
}

function formatText(msg) {
  const lines = [];
  lines.push(`*${escMd(msg.title)}*`);
  lines.push("");

  const l = msg.labels || {};
  if (msg.project) lines.push(`📁 ${escMd(l.project || "项目")}: \`${escMd(msg.project)}\``);
  if (msg.branch) lines.push(`🌿 ${escMd(l.branch || "分支")}: \`${escMd(msg.branch)}\``);
  if (msg.host) lines.push(`💻 ${escMd(l.host || "机器")}: \`${escMd(msg.host)}\``);
  if (msg.duration) lines.push(`⏱ ${escMd(l.duration || "耗时")}: ${escMd(msg.duration)}`);

  if (msg.summary) {
    lines.push("");
    lines.push(escMd(msg.summary));
  }

  return lines.join("\n");
}

// Escape Markdown V1 special chars
function escMd(str) {
  if (!str) return "";
  return str.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

module.exports = { send };
