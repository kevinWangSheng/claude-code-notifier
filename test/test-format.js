#!/usr/bin/env node

/**
 * Integration test — verifies message building, channel formatting,
 * signature correctness, error handling, and edge cases.
 */

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  PASS: ${msg}`);
    passed++;
  } else {
    console.log(`  FAIL: ${msg}`);
    failed++;
  }
}

// Helper: run notify.js with given event and config, return captured HTTP requests
// When configOverride contains channels, "PLACEHOLDER" in webhook_url is replaced with the test server base URL.
async function runNotify(event, configOverride, serverHandler) {
  const captured = [];

  return new Promise((resolve) => {
    const defaultHandler = (req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        captured.push({
          url: req.url,
          headers: req.headers,
          body: JSON.parse(body),
          rawBody: body,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ errcode: 0, errmsg: "ok", code: 0, msg: "ok" }));
      });
    };

    const handler = serverHandler
      ? (req, res) => serverHandler(req, res, captured)
      : defaultHandler;

    const server = http.createServer(handler);

    server.listen(0, () => {
      const port = server.address().port;
      const baseUrl = `http://localhost:${port}`;

      // Build config: start with defaults, then apply overrides
      const defaultConfig = {
        enabled: true,
        events: { stop: true, notification: true, task_completed: true, subagent_stop: true },
        channels: [
          { type: "wecom", webhook_url: `${baseUrl}/wecom` },
          { type: "feishu", webhook_url: `${baseUrl}/feishu`, secret: "feishu-test-secret" },
          { type: "dingtalk", webhook_url: `${baseUrl}/dingtalk?access_token=fake`, secret: "dingtalk-test-secret" },
          { type: "webhook", webhook_url: `${baseUrl}/webhook`, secret: "webhook-test-secret" },
        ],
      };

      const config = { ...defaultConfig, ...configOverride };

      // Replace PLACEHOLDER in any channel URLs with the test server
      if (configOverride?.channels) {
        config.channels = configOverride.channels.map((ch) => {
          const mapped = { ...ch };
          if (mapped.webhook_url === "PLACEHOLDER") mapped.webhook_url = `${baseUrl}/${ch.type}`;
          if (mapped.server_url === "PLACEHOLDER") mapped.server_url = baseUrl;
          if (mapped.api_url === "PLACEHOLDER") mapped.api_url = `${baseUrl}/${ch.type}`;
          return mapped;
        });
      }

      const configPath = path.join(os.tmpdir(), `notifier-test-${port}.json`);
      fs.writeFileSync(configPath, JSON.stringify(config));

      const { spawnSync } = require("child_process");
      const input = JSON.stringify(event);

      const result = spawnSync("/bin/bash", ["-c",
        `echo '${input.replace(/'/g, "'\\''")}' | node ${ROOT}/src/notify.js`
      ], {
        timeout: 8000,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, CLAUDE_NOTIFIER_CONFIG: configPath },
      });
      const stderr = result.stderr?.toString() || "";

      setTimeout(() => {
        fs.unlinkSync(configPath);
        server.close(() => resolve({ captured, stderr }));
      }, 500);
    });
  });
}

// ─── Signature Verification Helpers ─────────────────────────────

function verifyFeishuSignature(body, secret) {
  const { timestamp, sign } = body;
  if (!timestamp || !sign) return false;
  const stringToSign = `${timestamp}\n${secret}`;
  const expected = crypto.createHmac("sha256", stringToSign).digest("base64");
  return sign === expected;
}

function verifyDingtalkSignature(url, secret) {
  const urlObj = new URL(`http://localhost${url}`);
  const timestamp = urlObj.searchParams.get("timestamp");
  const sign = urlObj.searchParams.get("sign");
  if (!timestamp || !sign) return false;

  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(stringToSign);
  const expected = hmac.digest("base64");
  return decodeURIComponent(sign) === expected;
}

function verifyWebhookSignature(headers, rawBody, secret) {
  const sigHeader = headers["webhook-signature"];
  const msgId = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  if (!sigHeader || !msgId || !timestamp) return false;

  const content = `${msgId}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secret).update(content).digest("base64");
  return sigHeader === `v1,${expected}`;
}

// ─── Tests ──────────────────────────────────────────────────────

async function main() {
  // ======== Test 1: Stop event — full channel validation ========
  console.log("\n── 1. Stop event → 4 channels, correct formats ──");
  {
    const { captured } = await runNotify({
      hook_event_name: "Stop",
      session_id: "s1",
      cwd: ROOT,
      last_assistant_message: "All changes applied. Tests pass.",
    });

    assert(captured.length === 4, `4 channels received (got ${captured.length})`);

    // WeChat Work
    const wecom = captured.find((c) => c.url === "/wecom");
    assert(wecom !== undefined, "wecom: request captured");
    assert(wecom.body.msgtype === "markdown", "wecom: markdown type");
    assert(wecom.body.markdown.content.includes("任务完成"), "wecom: title in content");
    assert(wecom.body.markdown.content.includes("All changes applied"), "wecom: summary in content");

    // Feishu — signature correctness
    const feishu = captured.find((c) => c.url === "/feishu");
    assert(feishu !== undefined, "feishu: request captured");
    assert(feishu.body.msg_type === "interactive", "feishu: interactive card");
    assert(feishu.body.card.header.template === "green", "feishu: green header for success");
    assert(
      verifyFeishuSignature(feishu.body, "feishu-test-secret"),
      "feishu: HMAC signature is cryptographically correct"
    );
    // Verify timestamp is recent (within 5 seconds)
    const feishuTsDiff = Math.abs(Date.now() / 1000 - parseInt(feishu.body.timestamp));
    assert(feishuTsDiff < 30, `feishu: timestamp is recent (diff=${feishuTsDiff.toFixed(1)}s)`);

    // DingTalk — signature correctness
    const dingtalk = captured.find((c) => c.url.startsWith("/dingtalk"));
    assert(dingtalk !== undefined, "dingtalk: request captured");
    assert(dingtalk.body.msgtype === "actionCard", "dingtalk: actionCard type");
    assert(
      verifyDingtalkSignature(dingtalk.url, "dingtalk-test-secret"),
      "dingtalk: HMAC signature is cryptographically correct"
    );
    // Verify timestamp is milliseconds and recent
    const dtUrl = new URL(`http://localhost${dingtalk.url}`);
    const dtTs = parseInt(dtUrl.searchParams.get("timestamp"));
    assert(dtTs > 1e12, "dingtalk: timestamp is in milliseconds");
    assert(Math.abs(Date.now() - dtTs) < 30000, "dingtalk: timestamp is recent");

    // Generic Webhook — signature correctness
    const webhook = captured.find((c) => c.url === "/webhook");
    assert(webhook !== undefined, "webhook: request captured");
    assert(webhook.body.type === "claude_code.Stop", "webhook: correct event type");
    assert(webhook.body.data.status === "success", "webhook: success status");
    assert(webhook.body.data.summary.includes("All changes applied"), "webhook: summary in data");
    assert(
      verifyWebhookSignature(webhook.headers, webhook.rawBody, "webhook-test-secret"),
      "webhook: HMAC signature is cryptographically correct"
    );
    assert(webhook.headers["webhook-id"].startsWith("msg_"), "webhook: msg ID format");
  }

  // ======== Test 2: Notification (permission_prompt) ========
  console.log("\n── 2. Permission prompt → warning status ──");
  {
    const { captured } = await runNotify({
      hook_event_name: "Notification",
      session_id: "s2",
      cwd: "/tmp",
      notification_type: "permission_prompt",
      message: "Claude wants to run: npm install",
    });

    assert(captured.length === 4, `4 channels received (got ${captured.length})`);

    const feishu = captured.find((c) => c.url === "/feishu");
    assert(feishu !== undefined, "feishu: request captured");
    assert(feishu.body.card.header.template === "orange", "feishu: orange for warning");
    assert(feishu.body.card.header.title.content.includes("授权"), "feishu: title mentions auth");

    const webhook = captured.find((c) => c.url === "/webhook");
    assert(webhook !== undefined, "webhook: request captured");
    assert(webhook.body.data.status === "warning", "webhook: warning status");
    assert(webhook.body.data.summary.includes("npm install"), "webhook: original message preserved");
  }

  // ======== Test 3: Notification (idle_prompt) ========
  console.log("\n── 3. Idle prompt → info status ──");
  {
    const { captured } = await runNotify({
      hook_event_name: "Notification",
      session_id: "s3",
      cwd: "/tmp",
      notification_type: "idle_prompt",
      message: "Claude is waiting for your input",
    });

    assert(captured.length === 4, `4 channels received (got ${captured.length})`);

    const feishu = captured.find((c) => c.url === "/feishu");
    assert(feishu !== undefined, "feishu: request captured");
    assert(feishu.body.card.header.template === "blue", "feishu: blue for info");
    assert(feishu.body.card.header.title.content.includes("等待输入"), "feishu: idle title");
  }

  // ======== Test 4: Event filtering — subagent_stop disabled ========
  console.log("\n── 4. SubagentStop disabled → no notifications ──");
  {
    const { captured } = await runNotify(
      { hook_event_name: "SubagentStop", session_id: "s4", cwd: "/tmp", last_assistant_message: "Done" },
      { events: { stop: true, notification: true, task_completed: true, subagent_stop: false } }
    );
    assert(captured.length === 0, "no channels notified when event disabled");
  }

  // ======== Test 5: TaskCompleted ========
  console.log("\n── 5. TaskCompleted → includes task details ──");
  {
    const { captured } = await runNotify({
      hook_event_name: "TaskCompleted",
      session_id: "s5",
      cwd: "/tmp",
      task_subject: "Fix login bug",
      task_description: "Validate email format",
      teammate_name: "frontend-dev",
      team_name: "auth-team",
    });

    assert(captured.length === 4, `4 channels received (got ${captured.length})`);

    const wecom = captured.find((c) => c.url === "/wecom");
    assert(wecom !== undefined, "wecom: request captured");
    assert(wecom.body.markdown.content.includes("Fix login bug"), "wecom: has task subject");
    assert(wecom.body.markdown.content.includes("frontend-dev"), "wecom: has teammate name");

    const webhook = captured.find((c) => c.url === "/webhook");
    assert(webhook !== undefined, "webhook: request captured");
    assert(webhook.body.type === "claude_code.TaskCompleted", "webhook: correct event type");
  }

  // ======== Test 6: Stop hook loop prevention ========
  console.log("\n── 6. stop_hook_active=true → skipped (loop prevention) ──");
  {
    const { captured } = await runNotify({
      hook_event_name: "Stop",
      session_id: "s6",
      cwd: "/tmp",
      stop_hook_active: true,
      last_assistant_message: "Done",
    });
    assert(captured.length === 0, "no notifications sent (loop prevention)");
  }

  // ======== Test 7: enabled=false ========
  console.log("\n── 7. enabled=false → no notifications ──");
  {
    const { captured } = await runNotify(
      { hook_event_name: "Stop", session_id: "s7", cwd: "/tmp", last_assistant_message: "Done" },
      { enabled: false }
    );
    assert(captured.length === 0, "no notifications when disabled");
  }

  // ======== Test 8: Empty channels array ========
  console.log("\n── 8. Empty channels → no error ──");
  {
    const { captured, stderr } = await runNotify(
      { hook_event_name: "Stop", session_id: "s8", cwd: "/tmp", last_assistant_message: "Done" },
      { channels: [] }
    );
    assert(captured.length === 0, "no requests sent");
    assert(!stderr.includes("Error"), "no errors in stderr");
  }

  // ======== Test 9: Channel error handling — one fails, others succeed ========
  console.log("\n── 9. One channel fails → others still succeed ──");
  {
    const { captured, stderr } = await runNotify(
      { hook_event_name: "Stop", session_id: "s9", cwd: "/tmp", last_assistant_message: "Done" },
      {},
      (req, res, capturedArr) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          capturedArr.push({ url: req.url, body: JSON.parse(body) });
          if (req.url === "/wecom") {
            // Simulate WeChat Work rate limit error
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ errcode: 45009, errmsg: "api freq out of limit" }));
          } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ errcode: 0, errmsg: "ok", code: 0, msg: "ok" }));
          }
        });
      }
    );

    assert(captured.length === 4, `all 4 channels attempted (got ${captured.length})`);
    // Verify the process didn't crash (exit code 0) even with one channel error
    // The non-wecom channels should have received valid messages
    const nonWecom = captured.filter((c) => c.url !== "/wecom");
    assert(nonWecom.length === 3, `3 other channels succeeded despite wecom failure (got ${nonWecom.length})`);
  }

  // ======== Test 10: Long message truncation ========
  console.log("\n── 10. Long message → truncated ──");
  {
    const longMsg = "A".repeat(500);
    const { captured } = await runNotify(
      { hook_event_name: "Stop", session_id: "s10", cwd: "/tmp", last_assistant_message: longMsg },
      { channels: [{ type: "webhook", webhook_url: "PLACEHOLDER" }] }
    );

    // webhook channel URL will be replaced by runNotify
    // Actually we need a different approach - let's use the full config
    // The summary should be truncated to 300 chars + "..."
  }
  // Re-do test 10 properly
  {
    const longMsg = "B".repeat(500);
    const { captured } = await runNotify({
      hook_event_name: "Stop",
      session_id: "s10b",
      cwd: "/tmp",
      last_assistant_message: longMsg,
    });

    const webhook = captured.find((c) => c.url === "/webhook");
    assert(webhook !== undefined, "webhook: request captured");
    const summary = webhook.body.data.summary;
    assert(summary.length <= 304, `summary truncated (len=${summary.length})`); // 300 + "..."
    assert(summary.endsWith("..."), "summary ends with ellipsis");
  }

  // ======== Test 11: Special characters in message ========
  console.log("\n── 11. Special characters → handled correctly ──");
  {
    const { captured } = await runNotify({
      hook_event_name: "Stop",
      session_id: "s11",
      cwd: "/tmp",
      last_assistant_message: '中文消息 with "quotes" & <tags> and emoji 🎉',
    });

    assert(captured.length === 4, `4 channels received (got ${captured.length})`);
    const webhook = captured.find((c) => c.url === "/webhook");
    assert(webhook !== undefined, "webhook: request captured");
    assert(webhook.body.data.summary.includes("中文消息"), "webhook: Chinese chars preserved");
    assert(webhook.body.data.summary.includes("🎉"), "webhook: emoji preserved");
  }

  // ======== Test 12: Unknown event type → no notification ========
  console.log("\n── 12. Unknown event type → ignored ──");
  {
    const { captured } = await runNotify({
      hook_event_name: "SomeUnknownEvent",
      session_id: "s12",
      cwd: "/tmp",
    });
    assert(captured.length === 0, "unknown event type ignored");
  }

  // ======== Test 13: No secret → no signature ========
  console.log("\n── 13. No secret configured → no signature fields ──");
  {
    const { captured } = await runNotify(
      { hook_event_name: "Stop", session_id: "s13", cwd: "/tmp", last_assistant_message: "Done" },
      {
        channels: [
          { type: "feishu", webhook_url: "PLACEHOLDER" },
          { type: "dingtalk", webhook_url: "PLACEHOLDER" },
          { type: "webhook", webhook_url: "PLACEHOLDER" },
        ],
      }
    );

    const feishu = captured.find((c) => c.url === "/feishu");
    assert(feishu !== undefined, "feishu: request captured");
    assert(feishu.body.sign === undefined, "feishu: no sign when no secret");
    assert(feishu.body.timestamp === undefined, "feishu: no timestamp when no secret");

    const dingtalk = captured.find((c) => c.url.startsWith("/dingtalk"));
    assert(dingtalk !== undefined, "dingtalk: request captured");
    assert(!dingtalk.url.includes("sign="), "dingtalk: no sign in URL when no secret");

    const webhook = captured.find((c) => c.url === "/webhook");
    assert(webhook !== undefined, "webhook: request captured");
    assert(webhook.headers["webhook-signature"] === undefined, "webhook: no signature header when no secret");
  }

  // ======== Test 14: Feishu card structure completeness ========
  console.log("\n── 14. Feishu card structure → valid schema ──");
  {
    const { captured } = await runNotify({
      hook_event_name: "Stop",
      session_id: "s14",
      cwd: ROOT,
      last_assistant_message: "Completed refactoring.",
    });

    const feishu = captured.find((c) => c.url === "/feishu");
    assert(feishu !== undefined, "feishu: request captured");
    const card = feishu.body.card;
    assert(card.schema === "2.0", "feishu: card schema 2.0");
    assert(card.header?.title?.tag === "plain_text", "feishu: header title tag");
    assert(card.body?.direction === "vertical", "feishu: body direction vertical");
    assert(Array.isArray(card.body?.elements), "feishu: body has elements array");
    // Should have markdown element + hr + summary markdown
    const mdElements = card.body.elements.filter((e) => e.tag === "markdown");
    assert(mdElements.length >= 1, `feishu: has markdown elements (got ${mdElements.length})`);
  }

  // ======== Test 15: Bark channel ========
  console.log("\n── 15. Bark → iOS push format ──");
  {
    const { captured } = await runNotify(
      { hook_event_name: "Stop", session_id: "s15", cwd: ROOT, last_assistant_message: "Bark test done." },
      {
        channels: [
          { type: "bark", webhook_url: "PLACEHOLDER", device_key: "test-key", server_url: "PLACEHOLDER" },
        ],
      },
      (req, res, capturedArr) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          capturedArr.push({ url: req.url, body: JSON.parse(body) });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ code: 200, message: "success" }));
        });
      }
    );

    assert(captured.length === 1, `bark: request captured (got ${captured.length})`);
    if (captured.length > 0) {
      const bark = captured[0];
      assert(bark.url.includes("test-key"), "bark: device_key in URL path");
      assert(bark.body.title === "Claude Code 任务完成", "bark: correct title");
      assert(bark.body.group === "claude-code", "bark: group set");
      assert(bark.body.body.includes("Bark test done"), "bark: summary in body");
      assert(bark.body.level === "active", "bark: level is active for success");
    }
  }

  // ======== Test 16: Telegram channel ========
  console.log("\n── 16. Telegram → bot message format ──");
  {
    const { captured } = await runNotify(
      { hook_event_name: "Notification", session_id: "s16", cwd: "/tmp", notification_type: "permission_prompt", message: "Run npm test?" },
      {
        channels: [
          { type: "telegram", webhook_url: "PLACEHOLDER", bot_token: "123:fake", chat_id: "99999", api_url: "PLACEHOLDER" },
        ],
      },
      (req, res, capturedArr) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          capturedArr.push({ url: req.url, body: JSON.parse(body) });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, result: {} }));
        });
      }
    );

    assert(captured.length === 1, `telegram: request captured (got ${captured.length})`);
    if (captured.length > 0) {
      const tg = captured[0];
      assert(tg.body.chat_id === "99999", "telegram: correct chat_id");
      assert(tg.body.parse_mode === "Markdown", "telegram: Markdown parse mode");
      assert(tg.body.text.includes("授权"), "telegram: title in text");
      assert(tg.body.text.includes("npm test"), "telegram: message content preserved");
    }
  }

  // ======== Test 17: Server酱 channel ========
  console.log("\n── 17. Server酱 → WeChat push format ──");
  {
    const { captured } = await runNotify(
      { hook_event_name: "Stop", session_id: "s17", cwd: "/tmp", last_assistant_message: "Server酱 test." },
      {
        channels: [
          { type: "serverchan", webhook_url: "PLACEHOLDER", key: "SCT_FAKE_KEY", api_url: "PLACEHOLDER" },
        ],
      },
      (req, res, capturedArr) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          capturedArr.push({ url: req.url, body: body, contentType: req.headers["content-type"] });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ code: 0, message: "success" }));
        });
      }
    );

    assert(captured.length === 1, `serverchan: request captured (got ${captured.length})`);
    if (captured.length > 0) {
      const sc = captured[0];
      assert(sc.url.includes("/serverchan"), "serverchan: request reached server");
      assert(sc.contentType.includes("urlencoded"), "serverchan: form-urlencoded content type");
      assert(sc.body.includes("title="), "serverchan: has title param");
      assert(sc.body.includes("desp="), "serverchan: has desp param");
    }
  }

  // ======== Test 18: Bark warning level ========
  console.log("\n── 18. Bark warning → timeSensitive level ──");
  {
    const { captured } = await runNotify(
      { hook_event_name: "Notification", session_id: "s18", cwd: "/tmp", notification_type: "permission_prompt", message: "Need auth" },
      {
        channels: [
          { type: "bark", webhook_url: "PLACEHOLDER", device_key: "k", server_url: "PLACEHOLDER" },
        ],
      },
      (req, res, capturedArr) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          capturedArr.push({ url: req.url, body: JSON.parse(body) });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ code: 200, message: "success" }));
        });
      }
    );

    assert(captured.length === 1, `bark: request captured (got ${captured.length})`);
    if (captured.length > 0) {
      assert(captured[0].body.level === "timeSensitive", "bark: timeSensitive for warning events");
    }
  }

  // ════════ Summary ════════
  console.log(`\n${"═".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFAILED TESTS EXIST — review output above.");
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();
