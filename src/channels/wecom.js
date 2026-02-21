/**
 * WeChat Work (企业微信) group robot webhook
 * Docs: https://developer.work.weixin.qq.com/document/path/91770
 *
 * Auth: key in URL (no signing needed)
 * Rate limit: 20 msgs/min
 * Max payload: 20 KB
 */

async function send(channelConfig, message) {
  const { webhook_url } = channelConfig;
  if (!webhook_url) throw new Error("wecom: webhook_url is required");

  const body = {
    msgtype: "markdown",
    markdown: {
      content: formatMarkdown(message),
    },
  };

  const resp = await fetch(webhook_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const result = await resp.json();
  if (result.errcode !== 0) {
    throw new Error(`wecom: ${result.errcode} - ${result.errmsg}`);
  }
  return result;
}

function formatMarkdown(msg) {
  const lines = [];
  lines.push(`<font color="${statusColor(msg.status)}">${msg.title}</font>`);
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

function statusColor(status) {
  switch (status) {
    case "success":
      return "info";
    case "warning":
      return "warning";
    case "error":
      return "warning";
    default:
      return "comment";
  }
}

module.exports = { send };
