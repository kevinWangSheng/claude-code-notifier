/**
 * Email notifications via SMTP
 * Zero dependencies — uses Node.js built-in net/tls modules.
 *
 * Supports:
 * - SSL/TLS (port 465): direct TLS connection
 * - STARTTLS (port 587): upgrade plaintext to TLS
 * - AUTH LOGIN
 *
 * Config:
 * {
 *   "type": "email",
 *   "smtp_host": "smtp.gmail.com",
 *   "smtp_port": 465,
 *   "username": "you@gmail.com",
 *   "password": "app-password",
 *   "from": "you@gmail.com",
 *   "to": "you@gmail.com"
 * }
 */

const net = require("node:net");
const tls = require("node:tls");

async function send(channelConfig, message) {
  const {
    smtp_host,
    smtp_port = 465,
    username,
    password,
    from,
    to,
  } = channelConfig;

  if (!smtp_host) throw new Error("email: smtp_host is required");
  if (!from || !to) throw new Error("email: from and to are required");

  const subject = message.title;
  const body = formatEmailBody(message);
  const mime = buildMime(from, to, subject, body);

  await sendSmtp({ smtp_host, smtp_port, username, password, from, to, mime });
}

function formatEmailBody(msg) {
  const lines = [];
  lines.push(`<h2>${esc(msg.title)}</h2>`);
  lines.push("<table>");
  const l = msg.labels || {};
  if (msg.project) lines.push(`<tr><td><b>${esc(l.project || "项目")}</b></td><td>${esc(msg.project)}</td></tr>`);
  if (msg.branch) lines.push(`<tr><td><b>${esc(l.branch || "分支")}</b></td><td>${esc(msg.branch)}</td></tr>`);
  if (msg.host) lines.push(`<tr><td><b>${esc(l.host || "机器")}</b></td><td>${esc(msg.host)}</td></tr>`);
  if (msg.duration) lines.push(`<tr><td><b>${esc(l.duration || "耗时")}</b></td><td>${esc(msg.duration)}</td></tr>`);
  lines.push("</table>");
  if (msg.summary) lines.push(`<p>${esc(msg.summary)}</p>`);
  return lines.join("\n");
}

function esc(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildMime(from, to, subject, htmlBody) {
  // Encode subject with RFC 2047 for non-ASCII
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;

  return [
    `From: Claude Code Notifier <${from}>`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    `Date: ${new Date().toUTCString()}`,
    ``,
    Buffer.from(htmlBody).toString("base64"),
  ].join("\r\n");
}

// ─── Minimal SMTP Client ────────────────────────────────────────

function sendSmtp({ smtp_host, smtp_port, username, password, from, to, mime }) {
  return new Promise((resolve, reject) => {
    const useDirectTls = smtp_port === 465;
    const timeout = 15000;

    let socket;
    let buffer = "";
    let step = 0;
    let timer;

    function cleanup() {
      clearTimeout(timer);
      socket?.destroy();
    }

    function fail(msg) {
      cleanup();
      reject(new Error(`email: ${msg}`));
    }

    timer = setTimeout(() => fail("SMTP timeout"), timeout);

    function connect() {
      if (useDirectTls) {
        socket = tls.connect(smtp_port, smtp_host, { servername: smtp_host }, () => {});
      } else {
        socket = net.createConnection(smtp_port, smtp_host);
      }

      socket.setEncoding("utf8");
      socket.on("error", (err) => fail(`SMTP error: ${err.message}`));
      socket.on("data", onData);
    }

    function onData(data) {
      buffer += data;
      // SMTP responses end with \r\n; multi-line responses use dash continuation
      const lines = buffer.split("\r\n");
      // Check if the last complete line is a final response (code + space)
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];
        if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
          buffer = lines.slice(i + 1).join("\r\n");
          handleResponse(line);
          return;
        }
      }
    }

    const steps = [];

    function handleResponse(line) {
      const code = parseInt(line.slice(0, 3));

      switch (step) {
        case 0: // Server greeting
          if (code !== 220) return fail(`Unexpected greeting: ${line}`);
          socket.write(`EHLO localhost\r\n`);
          step = 1;
          break;

        case 1: // EHLO response
          if (code === 250) {
            if (!useDirectTls && line.toLowerCase().includes("starttls")) {
              // Need STARTTLS — but we handle it in step 1.5
            }
            if (!useDirectTls) {
              socket.write(`STARTTLS\r\n`);
              step = 2;
            } else if (username && password) {
              socket.write(`AUTH LOGIN\r\n`);
              step = 3;
            } else {
              socket.write(`MAIL FROM:<${from}>\r\n`);
              step = 6;
            }
          }
          break;

        case 2: // STARTTLS response
          if (code !== 220) return fail(`STARTTLS failed: ${line}`);
          // Upgrade to TLS
          const tlsSocket = tls.connect({
            socket,
            servername: smtp_host,
          }, () => {
            socket = tlsSocket;
            socket.setEncoding("utf8");
            socket.on("data", onData);
            socket.on("error", (err) => fail(`TLS error: ${err.message}`));
            socket.write(`EHLO localhost\r\n`);
            step = 2.5;
          });
          break;

        case 2.5: // EHLO after STARTTLS
          if (code === 250) {
            if (username && password) {
              socket.write(`AUTH LOGIN\r\n`);
              step = 3;
            } else {
              socket.write(`MAIL FROM:<${from}>\r\n`);
              step = 6;
            }
          }
          break;

        case 3: // AUTH LOGIN response
          if (code !== 334) return fail(`AUTH LOGIN failed: ${line}`);
          socket.write(Buffer.from(username).toString("base64") + "\r\n");
          step = 4;
          break;

        case 4: // Username accepted
          if (code !== 334) return fail(`AUTH username failed: ${line}`);
          socket.write(Buffer.from(password).toString("base64") + "\r\n");
          step = 5;
          break;

        case 5: // Auth complete
          if (code !== 235) return fail(`AUTH failed: ${line}`);
          socket.write(`MAIL FROM:<${from}>\r\n`);
          step = 6;
          break;

        case 6: // MAIL FROM accepted
          if (code !== 250) return fail(`MAIL FROM rejected: ${line}`);
          socket.write(`RCPT TO:<${to}>\r\n`);
          step = 7;
          break;

        case 7: // RCPT TO accepted
          if (code !== 250) return fail(`RCPT TO rejected: ${line}`);
          socket.write(`DATA\r\n`);
          step = 8;
          break;

        case 8: // DATA ready
          if (code !== 354) return fail(`DATA rejected: ${line}`);
          socket.write(mime + "\r\n.\r\n");
          step = 9;
          break;

        case 9: // Message accepted
          if (code !== 250) return fail(`Message rejected: ${line}`);
          socket.write(`QUIT\r\n`);
          cleanup();
          resolve();
          break;
      }
    }

    connect();
  });
}

module.exports = { send };
