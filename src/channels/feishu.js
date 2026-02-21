/**
 * Feishu/Lark (飞书) custom bot webhook
 * Docs: https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 *
 * Auth: optional HMAC-SHA256 signature in JSON body
 * Signature: HMAC-SHA256(timestamp + "\n" + secret) with empty message, base64 encoded
 * Timestamp unit: seconds
 * Rate limit: 100 msgs/min, 5 msgs/sec
 * Max payload: 20 KB
 */

const crypto = require("node:crypto");

async function send(channelConfig, message) {
  const { webhook_url, secret } = channelConfig;
  if (!webhook_url) throw new Error("feishu: webhook_url is required");

  const body = {
    msg_type: "interactive",
    card: buildCard(message),
  };

  // Add signature if secret is configured
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const stringToSign = `${timestamp}\n${secret}`;
    const sign = crypto
      .createHmac("sha256", stringToSign)
      .digest("base64");
    body.timestamp = timestamp;
    body.sign = sign;
  }

  const resp = await fetch(webhook_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const result = await resp.json();
  if (result.code !== 0 && result.StatusCode !== 0) {
    throw new Error(`feishu: ${result.code || result.StatusCode} - ${result.msg || result.StatusMessage}`);
  }
  return result;
}

function buildCard(msg) {
  const elements = [];

  // Info fields
  const fields = [];
  const l = msg.labels || {};
  if (msg.project) fields.push(`**${l.project || "项目"}**: ${msg.project}`);
  if (msg.branch) fields.push(`**${l.branch || "分支"}**: ${msg.branch}`);
  if (msg.host) fields.push(`**${l.host || "机器"}**: ${msg.host}`);
  if (msg.duration) fields.push(`**${l.duration || "耗时"}**: ${msg.duration}`);

  if (fields.length > 0) {
    elements.push({
      tag: "markdown",
      content: fields.join("\n"),
    });

    elements.push({ tag: "hr" });
  }

  // Summary
  if (msg.summary) {
    elements.push({
      tag: "markdown",
      content: msg.summary,
    });
  }

  return {
    schema: "2.0",
    header: {
      title: { tag: "plain_text", content: msg.title },
      template: headerColor(msg.status),
    },
    body: {
      direction: "vertical",
      elements,
    },
  };
}

function headerColor(status) {
  switch (status) {
    case "success":
      return "green";
    case "warning":
      return "orange";
    case "error":
      return "red";
    default:
      return "blue";
  }
}

module.exports = { send };
