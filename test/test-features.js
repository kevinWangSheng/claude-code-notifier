#!/usr/bin/env node

/**
 * Tests for enhanced features:
 * - min_duration_seconds
 * - cooldown_seconds
 * - quiet_hours
 * - per-channel event filtering
 * - i18n (language)
 * - SessionStart duration tracking
 */

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const STATE_DIR = path.join(os.tmpdir(), "claude-code-notifier");
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

// Helper: run notify.js
function runNotifySync(event, config) {
  const { spawnSync } = require("child_process");
  const cfgPath = path.join(os.tmpdir(), `feat-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(cfgPath, JSON.stringify(config));
  const input = JSON.stringify(event);
  const r = spawnSync("/bin/bash", ["-c",
    `echo '${input.replace(/'/g, "'\\''")}' | node ${ROOT}/src/notify.js`
  ], {
    timeout: 8000,
    env: { ...process.env, CLAUDE_NOTIFIER_CONFIG: cfgPath },
  });
  try { fs.unlinkSync(cfgPath); } catch {}
  return { exitCode: r.status, stderr: r.stderr?.toString() || "" };
}

// Helper: run with HTTP capture
async function runWithCapture(event, configOverride) {
  const captured = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        captured.push({ url: req.url, body: JSON.parse(body) });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ errcode: 0, errmsg: "ok", code: 0, msg: "ok" }));
      });
    });
    server.listen(0, () => {
      const port = server.address().port;
      const config = {
        enabled: true,
        events: { stop: true, notification: true, task_completed: true, subagent_stop: true },
        channels: [
          { type: "wecom", webhook_url: `http://localhost:${port}/wecom` },
        ],
        ...configOverride,
      };
      // Replace PLACEHOLDER
      if (config.channels) {
        config.channels = config.channels.map((ch) => ({
          ...ch,
          webhook_url: (ch.webhook_url || "").replace("PLACEHOLDER", `http://localhost:${port}/${ch.type}`),
        }));
      }
      const cfgPath = path.join(os.tmpdir(), `feat-test-${port}.json`);
      fs.writeFileSync(cfgPath, JSON.stringify(config));
      const { spawnSync } = require("child_process");
      const input = JSON.stringify(event);
      const r = spawnSync("/bin/bash", ["-c",
        `echo '${input.replace(/'/g, "'\\''")}' | node ${ROOT}/src/notify.js`
      ], {
        timeout: 8000,
        env: { ...process.env, CLAUDE_NOTIFIER_CONFIG: cfgPath },
      });
      setTimeout(() => {
        try { fs.unlinkSync(cfgPath); } catch {}
        server.close(() => resolve({ captured, stderr: r.stderr?.toString() || "" }));
      }, 500);
    });
  });
}

// Cleanup state dir before tests
function cleanState() {
  try {
    const files = fs.readdirSync(STATE_DIR);
    for (const f of files) {
      fs.unlinkSync(path.join(STATE_DIR, f));
    }
  } catch {}
}

async function main() {
  cleanState();

  // ======== Test 1: SessionStart saves timestamp ========
  console.log("\n── 1. SessionStart → saves timestamp file ──");
  {
    const config = { enabled: true, channels: [] };
    runNotifySync(
      { hook_event_name: "SessionStart", session_id: "dur-test-1", cwd: "/tmp" },
      config
    );
    const tsFile = path.join(STATE_DIR, "session-dur-test-1.ts");
    assert(fs.existsSync(tsFile), "timestamp file created");
    const ts = parseInt(fs.readFileSync(tsFile, "utf-8"));
    assert(Math.abs(Date.now() - ts) < 5000, `timestamp is recent (diff=${Date.now() - ts}ms)`);
  }

  // ======== Test 2: Stop event includes duration ========
  console.log("\n── 2. Stop after SessionStart → includes duration ──");
  {
    // Write a timestamp 65 seconds ago
    const tsFile = path.join(STATE_DIR, "session-dur-test-2.ts");
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(tsFile, (Date.now() - 65000).toString());

    const { captured } = await runWithCapture(
      { hook_event_name: "Stop", session_id: "dur-test-2", cwd: "/tmp", last_assistant_message: "Done" },
      {}
    );

    assert(captured.length === 1, `notification sent (got ${captured.length})`);
    if (captured.length > 0) {
      const content = captured[0].body.markdown?.content || "";
      assert(content.includes("1m"), `duration shows ~1m (content: ${content.slice(0, 200)})`);
    }
  }

  // ======== Test 3: min_duration_seconds filters short tasks ========
  console.log("\n── 3. min_duration_seconds → short task filtered ──");
  {
    // Write a timestamp 5 seconds ago (short task)
    const tsFile = path.join(STATE_DIR, "session-dur-test-3.ts");
    fs.writeFileSync(tsFile, (Date.now() - 5000).toString());

    const { captured } = await runWithCapture(
      { hook_event_name: "Stop", session_id: "dur-test-3", cwd: "/tmp", last_assistant_message: "Quick reply" },
      { min_duration_seconds: 30 }
    );

    assert(captured.length === 0, "short task notification filtered out");
  }

  // ======== Test 4: min_duration_seconds allows long tasks ========
  console.log("\n── 4. min_duration_seconds → long task passes through ──");
  {
    const tsFile = path.join(STATE_DIR, "session-dur-test-4.ts");
    fs.writeFileSync(tsFile, (Date.now() - 120000).toString());

    const { captured } = await runWithCapture(
      { hook_event_name: "Stop", session_id: "dur-test-4", cwd: "/tmp", last_assistant_message: "Done" },
      { min_duration_seconds: 30 }
    );

    assert(captured.length === 1, "long task notification sent");
  }

  // ======== Test 5: min_duration_seconds does NOT filter Notification events ========
  console.log("\n── 5. min_duration_seconds → Notification events always sent ──");
  {
    const tsFile = path.join(STATE_DIR, "session-dur-test-5.ts");
    fs.writeFileSync(tsFile, (Date.now() - 2000).toString());

    const { captured } = await runWithCapture(
      { hook_event_name: "Notification", session_id: "dur-test-5", cwd: "/tmp", notification_type: "permission_prompt", message: "Auth needed" },
      { min_duration_seconds: 30 }
    );

    assert(captured.length === 1, "Notification event not filtered by min_duration");
  }

  // ======== Test 6: cooldown_seconds ========
  console.log("\n── 6. cooldown_seconds → second notification blocked ──");
  {
    // Write a "last notify" timestamp just now
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, "last-notify.ts"), Date.now().toString());

    const { captured } = await runWithCapture(
      { hook_event_name: "Stop", session_id: "cd-test-1", cwd: "/tmp", last_assistant_message: "Done" },
      { cooldown_seconds: 60 }
    );

    assert(captured.length === 0, "notification blocked by cooldown");
  }

  // ======== Test 7: cooldown expired → notification sent ========
  console.log("\n── 7. cooldown expired → notification sent ──");
  {
    // Write a timestamp 120 seconds ago
    fs.writeFileSync(path.join(STATE_DIR, "last-notify.ts"), (Date.now() - 120000).toString());

    const { captured } = await runWithCapture(
      { hook_event_name: "Stop", session_id: "cd-test-2", cwd: "/tmp", last_assistant_message: "Done" },
      { cooldown_seconds: 60 }
    );

    assert(captured.length === 1, "notification sent after cooldown expired");
  }

  // ======== Test 8: quiet_hours — currently in quiet period ========
  console.log("\n── 8. quiet_hours → notification blocked during quiet time ──");
  {
    const now = new Date();
    const currentHour = now.getHours();
    // Create a quiet range that includes current time
    const startHour = (currentHour - 1 + 24) % 24;
    const endHour = (currentHour + 1) % 24;
    const start = `${String(startHour).padStart(2, "0")}:00`;
    const end = `${String(endHour).padStart(2, "0")}:00`;

    const { captured } = await runWithCapture(
      { hook_event_name: "Stop", session_id: "qh-test-1", cwd: "/tmp", last_assistant_message: "Done" },
      {
        quiet_hours: { enabled: true, start, end },
        cooldown_seconds: 0,
      }
    );

    assert(captured.length === 0, `notification blocked (quiet: ${start}-${end})`);
  }

  // ======== Test 9: quiet_hours — outside quiet period ========
  console.log("\n── 9. quiet_hours → notification sent outside quiet time ──");
  {
    const now = new Date();
    const currentHour = now.getHours();
    // Create a quiet range that does NOT include current time
    const startHour = (currentHour + 3) % 24;
    const endHour = (currentHour + 5) % 24;
    const start = `${String(startHour).padStart(2, "0")}:00`;
    const end = `${String(endHour).padStart(2, "0")}:00`;

    const { captured } = await runWithCapture(
      { hook_event_name: "Stop", session_id: "qh-test-2", cwd: "/tmp", last_assistant_message: "Done" },
      {
        quiet_hours: { enabled: true, start, end },
        cooldown_seconds: 0,
      }
    );

    assert(captured.length === 1, `notification sent (quiet: ${start}-${end})`);
  }

  // ======== Test 10: per-channel event filtering ========
  console.log("\n── 10. per-channel events → channel only receives configured events ──");
  {
    const { captured } = await runWithCapture(
      { hook_event_name: "Stop", session_id: "pcf-test-1", cwd: "/tmp", last_assistant_message: "Done" },
      {
        cooldown_seconds: 0,
        channels: [
          // This channel only wants notification events, not stop
          { type: "wecom", webhook_url: "PLACEHOLDER", events: ["notification"] },
        ],
      }
    );

    assert(captured.length === 0, "channel with events=[notification] ignores Stop");
  }

  // ======== Test 11: per-channel event filtering — matching event ========
  console.log("\n── 11. per-channel events → matching event goes through ──");
  {
    const { captured } = await runWithCapture(
      { hook_event_name: "Notification", session_id: "pcf-test-2", cwd: "/tmp", notification_type: "permission_prompt", message: "Auth" },
      {
        cooldown_seconds: 0,
        channels: [
          { type: "wecom", webhook_url: "PLACEHOLDER", events: ["notification"] },
        ],
      }
    );

    assert(captured.length === 1, "channel with events=[notification] receives Notification");
  }

  // ======== Test 12: per-channel — no events field means accept all ========
  console.log("\n── 12. per-channel no events field → accepts all ──");
  {
    const { captured } = await runWithCapture(
      { hook_event_name: "Stop", session_id: "pcf-test-3", cwd: "/tmp", last_assistant_message: "Done" },
      {
        cooldown_seconds: 0,
        channels: [
          { type: "wecom", webhook_url: "PLACEHOLDER" },
        ],
      }
    );

    assert(captured.length === 1, "channel without events field accepts all");
  }

  // ======== Test 13: language=en ========
  console.log("\n── 13. language=en → English titles and labels ──");
  {
    const { captured } = await runWithCapture(
      { hook_event_name: "Stop", session_id: "lang-test-1", cwd: "/tmp", last_assistant_message: "Done" },
      { language: "en", cooldown_seconds: 0 }
    );

    assert(captured.length === 1, "notification sent");
    if (captured.length > 0) {
      const content = captured[0].body.markdown?.content || "";
      assert(content.includes("Task Complete"), `English title found (content starts: ${content.slice(0, 80)})`);
      assert(content.includes("Project") || content.includes("Host"), "English labels used");
      assert(!content.includes("项目"), "No Chinese labels");
    }
  }

  // ======== Test 14: language=zh (default) ========
  console.log("\n── 14. language=zh → Chinese titles ──");
  {
    const { captured } = await runWithCapture(
      { hook_event_name: "Stop", session_id: "lang-test-2", cwd: "/tmp", last_assistant_message: "Done" },
      { language: "zh", cooldown_seconds: 0 }
    );

    assert(captured.length === 1, "notification sent");
    if (captured.length > 0) {
      const content = captured[0].body.markdown?.content || "";
      assert(content.includes("任务完成"), "Chinese title found");
    }
  }

  // ======== Test 15: formatDuration units ========
  console.log("\n── 15. Duration formatting → correct units ──");
  {
    // Test by directly requiring notify.js internals isn't possible since they're not exported.
    // Instead, test via state files with known timestamps.

    // 45 seconds ago
    fs.writeFileSync(path.join(STATE_DIR, "session-fmt-1.ts"), (Date.now() - 45000).toString());
    const { captured: c1 } = await runWithCapture(
      { hook_event_name: "Stop", session_id: "fmt-1", cwd: "/tmp", last_assistant_message: "A" },
      { cooldown_seconds: 0 }
    );
    if (c1.length > 0) {
      const md = c1[0].body.markdown?.content || "";
      assert(md.includes("45s") || md.includes("44s") || md.includes("46s"), `seconds format (${md.match(/\d+s/)?.[0]})`);
    }

    // 5 minutes 30 seconds ago
    fs.writeFileSync(path.join(STATE_DIR, "session-fmt-2.ts"), (Date.now() - 330000).toString());
    const { captured: c2 } = await runWithCapture(
      { hook_event_name: "Stop", session_id: "fmt-2", cwd: "/tmp", last_assistant_message: "B" },
      { cooldown_seconds: 0 }
    );
    if (c2.length > 0) {
      const md = c2[0].body.markdown?.content || "";
      assert(md.includes("5m 30s") || md.includes("5m 29s") || md.includes("5m 31s"), `minutes format (${md.match(/\d+m \d+s/)?.[0]})`);
    }

    // 2 hours 15 minutes ago
    fs.writeFileSync(path.join(STATE_DIR, "session-fmt-3.ts"), (Date.now() - 8100000).toString());
    const { captured: c3 } = await runWithCapture(
      { hook_event_name: "Stop", session_id: "fmt-3", cwd: "/tmp", last_assistant_message: "C" },
      { cooldown_seconds: 0 }
    );
    if (c3.length > 0) {
      const md = c3[0].body.markdown?.content || "";
      assert(md.includes("2h 15m") || md.includes("2h 14m"), `hours format (${md.match(/\d+h \d+m/)?.[0]})`);
    }
  }

  // Cleanup
  cleanState();

  // ════════ Summary ════════
  console.log(`\n${"═".repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFAILED TESTS EXIST — review output above.");
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();
