#!/usr/bin/env node

/**
 * Test script — starts a local HTTP server to capture webhook payloads,
 * then runs notify.js with test events to verify message formatting.
 */

const http = require("node:http");
const { execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..");
const PORT = 18932;

// Captured payloads
const captured = [];

// Start a tiny HTTP server
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const entry = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: JSON.parse(body),
    };
    captured.push(entry);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ errcode: 0, errmsg: "ok", code: 0, msg: "ok" }));
  });
});

server.listen(PORT, async () => {
  console.log(`Test server listening on :${PORT}\n`);

  // Write a temp config pointing to our local server
  const config = {
    enabled: true,
    events: {
      stop: true,
      notification: true,
      task_completed: true,
      subagent_stop: true,
    },
    channels: [
      { type: "wecom", webhook_url: `http://localhost:${PORT}/wecom` },
      { type: "feishu", webhook_url: `http://localhost:${PORT}/feishu`, secret: "test-secret" },
      { type: "dingtalk", webhook_url: `http://localhost:${PORT}/dingtalk`, secret: "test-secret" },
      { type: "webhook", webhook_url: `http://localhost:${PORT}/webhook`, secret: "test-secret" },
    ],
  };

  const configPath = path.join(os.tmpdir(), "claude-notifier-test.json");
  fs.writeFileSync(configPath, JSON.stringify(config));

  const testEvents = [
    {
      name: "Stop (task complete)",
      input: {
        hook_event_name: "Stop",
        session_id: "sess-001",
        cwd: ROOT,
        last_assistant_message:
          "I have completed all the requested changes. The authentication module now supports JWT with refresh tokens, and all tests pass.",
      },
    },
    {
      name: "Notification (permission prompt)",
      input: {
        hook_event_name: "Notification",
        session_id: "sess-002",
        cwd: ROOT,
        notification_type: "permission_prompt",
        message: "Claude wants to run: rm -rf node_modules && npm install",
      },
    },
    {
      name: "Notification (idle prompt)",
      input: {
        hook_event_name: "Notification",
        session_id: "sess-003",
        cwd: ROOT,
        notification_type: "idle_prompt",
        message: "Claude is waiting for your input",
      },
    },
    {
      name: "TaskCompleted",
      input: {
        hook_event_name: "TaskCompleted",
        session_id: "sess-004",
        cwd: ROOT,
        task_id: "task-1",
        task_subject: "Implement user login API",
        task_description: "Create POST /api/auth/login endpoint with JWT token generation",
        teammate_name: "backend-dev",
        team_name: "auth-team",
      },
    },
    {
      name: "SubagentStop",
      input: {
        hook_event_name: "SubagentStop",
        session_id: "sess-005",
        cwd: ROOT,
        last_assistant_message: "Research complete. Found 3 relevant test files that need updating.",
      },
    },
  ];

  for (const test of testEvents) {
    console.log(`── Testing: ${test.name} ──`);
    captured.length = 0;

    try {
      execSync(
        `echo '${JSON.stringify(test.input)}' | CLAUDE_NOTIFIER_CONFIG=${configPath} node ${ROOT}/src/notify.js`,
        { stdio: ["pipe", "pipe", "pipe"], timeout: 10000, shell: "/bin/bash" }
      );

      // Wait a tiny bit for async request to complete
      await new Promise((r) => setTimeout(r, 200));

      console.log(`  Channels notified: ${captured.length}`);
      for (const c of captured) {
        const channelName = c.url.replace("/", "");
        console.log(`  [${channelName}] ✓`);

        // Show message preview
        if (channelName === "webhook") {
          console.log(`    type: ${c.body.type}`);
          console.log(`    title: ${c.body.data.title}`);
          console.log(`    status: ${c.body.data.status}`);
          if (c.headers["webhook-signature"]) {
            console.log(`    signature: ${c.headers["webhook-signature"].slice(0, 30)}...`);
          }
        }
      }
      console.log();
    } catch (err) {
      console.log(`  ERROR: ${err.stderr?.toString() || err.message}\n`);
    }
  }

  // Cleanup
  fs.unlinkSync(configPath);
  server.close();
  console.log("All tests completed.");
});
