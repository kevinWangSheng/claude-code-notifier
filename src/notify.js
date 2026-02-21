#!/usr/bin/env node

/**
 * Claude Code Notifier — main entry point
 *
 * Receives hook event JSON on stdin from Claude Code,
 * formats a notification message, and sends it to all configured channels.
 *
 * Features:
 * - 8 notification channels (feishu, dingtalk, wecom, telegram, bark, serverchan, email, webhook)
 * - min_duration_seconds: skip notifications for quick tasks
 * - cooldown_seconds: rate limiting between notifications
 * - quiet_hours: do-not-disturb time window
 * - per-channel event filtering
 * - i18n: Chinese / English
 * - task duration tracking (via SessionStart timestamp)
 *
 * Zero external dependencies — uses only Node.js built-ins + global fetch.
 */

const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { loadConfig } = require("./config");

// Channel implementations
const channels = {
  wecom: require("./channels/wecom"),
  feishu: require("./channels/feishu"),
  dingtalk: require("./channels/dingtalk"),
  webhook: require("./channels/webhook"),
  bark: require("./channels/bark"),
  telegram: require("./channels/telegram"),
  serverchan: require("./channels/serverchan"),
  email: require("./channels/email"),
};

// ─── i18n ───────────────────────────────────────────────────────

const i18n = {
  zh: {
    task_complete: "Claude Code 任务完成",
    need_auth: "Claude Code 需要授权",
    waiting_input: "Claude Code 等待输入",
    notification: "Claude Code 通知",
    task_done: "任务完成",
    subagent_done: "Claude Code 子代理完成",
    default_auth_msg: "Claude 需要你的权限批准才能继续执行",
    default_idle_msg: "Claude 已完成当前任务，等待你的下一步指示",
    unknown_task: "未知任务",
    executor: "执行者",
    team: "团队",
    project: "项目",
    branch: "分支",
    host: "机器",
    duration: "耗时",
  },
  en: {
    task_complete: "Claude Code Task Complete",
    need_auth: "Claude Code Needs Authorization",
    waiting_input: "Claude Code Waiting for Input",
    notification: "Claude Code Notification",
    task_done: "Task Complete",
    subagent_done: "Claude Code Subagent Complete",
    default_auth_msg: "Claude needs your permission to continue",
    default_idle_msg: "Claude has finished and is waiting for your next instruction",
    unknown_task: "Unknown task",
    executor: "Executor",
    team: "Team",
    project: "Project",
    branch: "Branch",
    host: "Host",
    duration: "Duration",
  },
};

function t(config, key) {
  const lang = config.language || "zh";
  return (i18n[lang] || i18n.zh)[key] || i18n.zh[key] || key;
}

// ─── State Directory ────────────────────────────────────────────

const STATE_DIR = path.join(os.tmpdir(), "claude-code-notifier");

function ensureStateDir() {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  } catch {}
}

// ─── Stdin Reader ───────────────────────────────────────────────

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return JSON.parse(data);
}

// ─── Git Helpers ────────────────────────────────────────────────

function getGitInfo(cwd) {
  const info = { project: null, branch: null };
  try {
    const repoPath = execSync("git rev-parse --show-toplevel", {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 3000,
    })
      .toString()
      .trim();
    info.project = path.basename(repoPath);
    info.branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 3000,
    })
      .toString()
      .trim();
  } catch {
    if (cwd) info.project = path.basename(cwd);
  }
  return info;
}

// ─── Duration Tracking ─────────────────────────────────────────

function sessionTimestampPath(sessionId) {
  return path.join(STATE_DIR, `session-${sessionId}.ts`);
}

function saveSessionStart(sessionId) {
  ensureStateDir();
  fs.writeFileSync(sessionTimestampPath(sessionId), Date.now().toString());
}

function getSessionDuration(sessionId) {
  try {
    const startTs = parseInt(fs.readFileSync(sessionTimestampPath(sessionId), "utf-8"));
    if (isNaN(startTs)) return null;
    const durationMs = Date.now() - startTs;
    return durationMs;
  } catch {
    return null;
  }
}

function cleanupSessionTimestamp(sessionId) {
  try {
    fs.unlinkSync(sessionTimestampPath(sessionId));
  } catch {}
}

function formatDuration(ms) {
  if (ms == null || ms < 0) return null;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

// ─── Cooldown ───────────────────────────────────────────────────

const COOLDOWN_FILE = path.join(STATE_DIR, "last-notify.ts");

function checkCooldown(cooldownSeconds) {
  if (!cooldownSeconds || cooldownSeconds <= 0) return true;
  try {
    const lastTs = parseInt(fs.readFileSync(COOLDOWN_FILE, "utf-8"));
    if (isNaN(lastTs)) return true;
    return (Date.now() - lastTs) >= cooldownSeconds * 1000;
  } catch {
    return true;
  }
}

function updateCooldown() {
  ensureStateDir();
  fs.writeFileSync(COOLDOWN_FILE, Date.now().toString());
}

// ─── Quiet Hours ────────────────────────────────────────────────

function isInQuietHours(quietConfig) {
  if (!quietConfig || !quietConfig.enabled) return false;

  const { start, end } = quietConfig;
  if (!start || !end) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // Same-day range: e.g., 09:00 - 18:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Cross-midnight range: e.g., 23:00 - 08:00
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

// ─── Event → Message Mapping ────────────────────────────────────

function buildMessage(event, config) {
  const hookEvent = event.hook_event_name;
  const cwd = event.cwd || process.cwd();
  const git = getGitInfo(cwd);
  const hostname = os.hostname();
  const sessionId = event.session_id || null;

  // Calculate duration
  const durationMs = sessionId ? getSessionDuration(sessionId) : null;

  const base = {
    event: hookEvent,
    session_id: sessionId,
    project: git.project,
    branch: git.branch,
    host: hostname,
    duration: formatDuration(durationMs),
    durationMs,
    title: "",
    summary: "",
    status: "info",
    // i18n labels for channels to use
    labels: {
      project: t(config, "project"),
      branch: t(config, "branch"),
      host: t(config, "host"),
      duration: t(config, "duration"),
    },
  };

  switch (hookEvent) {
    case "Stop":
      return buildStopMessage(event, base, config);
    case "Notification":
      return buildNotificationMessage(event, base, config);
    case "TaskCompleted":
      return buildTaskCompletedMessage(event, base, config);
    case "SubagentStop":
      return buildSubagentStopMessage(event, base, config);
    default:
      return null;
  }
}

function buildStopMessage(event, base, config) {
  base.title = t(config, "task_complete");
  base.status = "success";
  const lastMsg = event.last_assistant_message || "";
  base.summary = truncate(lastMsg, 300);
  return base;
}

function buildNotificationMessage(event, base, config) {
  const notifType = event.notification_type || "";
  switch (notifType) {
    case "permission_prompt":
      base.title = t(config, "need_auth");
      base.status = "warning";
      base.summary = event.message || t(config, "default_auth_msg");
      break;
    case "idle_prompt":
      base.title = t(config, "waiting_input");
      base.status = "info";
      base.summary = event.message || t(config, "default_idle_msg");
      break;
    default:
      base.title = t(config, "notification");
      base.status = "info";
      base.summary = event.message || "";
      break;
  }
  return base;
}

function buildTaskCompletedMessage(event, base, config) {
  const subject = event.task_subject || t(config, "unknown_task");
  base.title = `${t(config, "task_done")}: ${subject}`;
  base.status = "success";
  const parts = [];
  if (event.teammate_name) parts.push(`${t(config, "executor")}: ${event.teammate_name}`);
  if (event.team_name) parts.push(`${t(config, "team")}: ${event.team_name}`);
  if (event.task_description) parts.push(truncate(event.task_description, 200));
  base.summary = parts.join("\n");
  return base;
}

function buildSubagentStopMessage(event, base, config) {
  base.title = t(config, "subagent_done");
  base.status = "success";
  const lastMsg = event.last_assistant_message || "";
  base.summary = truncate(lastMsg, 200);
  return base;
}

function truncate(str, maxLen) {
  if (!str) return "";
  const clean = str.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen) + "...";
}

// ─── Event Filtering ────────────────────────────────────────────

const EVENT_KEY_MAP = {
  Stop: "stop",
  Notification: "notification",
  TaskCompleted: "task_completed",
  SubagentStop: "subagent_stop",
};

const EVENT_DEFAULTS = {
  stop: true,
  notification: true,
  task_completed: true,
  subagent_stop: false,
};

function shouldNotify(event, config) {
  const hookEvent = event.hook_event_name;
  const eventKey = EVENT_KEY_MAP[hookEvent];
  if (!eventKey) return false;

  const eventSettings = config.events || {};
  const enabled = eventSettings[eventKey] ?? EVENT_DEFAULTS[eventKey] ?? false;
  if (!enabled) return false;

  // Prevent infinite loop
  if (hookEvent === "Stop" && event.stop_hook_active) return false;

  return true;
}

/**
 * Check if a specific channel should receive this event.
 * Channels can specify their own `events` array to filter.
 * If not specified, the channel receives all globally-enabled events.
 */
function channelAcceptsEvent(channelConfig, eventKey) {
  if (!channelConfig.events) return true; // no filter = accept all
  return channelConfig.events.includes(eventKey);
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  let event;
  try {
    event = await readStdin();
  } catch (err) {
    process.stderr.write(`notifier: failed to parse stdin: ${err.message}\n`);
    process.exit(1);
  }

  const hookEvent = event.hook_event_name;

  // Handle SessionStart — save timestamp for duration tracking
  if (hookEvent === "SessionStart") {
    if (event.session_id) {
      saveSessionStart(event.session_id);
    }
    // First-run hint: if no config exists, create a template
    const existingConfig = loadConfig(event.cwd);
    if (!existingConfig) {
      const configPath = path.join(os.homedir(), ".claude", "claude-notifier.json");
      try {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        if (!fs.existsSync(configPath)) {
          const template = {
            enabled: true,
            language: "zh",
            min_duration_seconds: 30,
            cooldown_seconds: 10,
            quiet_hours: { enabled: false, start: "23:00", end: "08:00" },
            events: { stop: true, notification: true, task_completed: true, subagent_stop: false },
            channels: [],
          };
          fs.writeFileSync(configPath, JSON.stringify(template, null, 2) + "\n");
          process.stderr.write(
            `[claude-code-notifier] Config template created at ${configPath}\n` +
            `  Run /claude-code-notifier:setup to configure notification channels.\n`
          );
        }
      } catch {}
    }
    process.exit(0);
  }

  const isTestMode = process.env.CLAUDE_NOTIFIER_TEST === "1";

  const config = loadConfig(event.cwd);
  if (!config) {
    process.exit(0);
  }

  if (config.enabled === false && !isTestMode) {
    process.exit(0);
  }

  // In test mode, skip all filtering — only verify that sending works
  let channelConfigs;

  if (isTestMode) {
    channelConfigs = config.channels || [];
    if (channelConfigs.length === 0) {
      process.stderr.write("notifier: no channels configured\n");
      process.exit(1);
    }
  } else {
    if (!shouldNotify(event, config)) {
      process.exit(0);
    }

    // Quiet hours check
    if (isInQuietHours(config.quiet_hours)) {
      process.exit(0);
    }

    // Cooldown check
    if (!checkCooldown(config.cooldown_seconds)) {
      process.exit(0);
    }
  }

  const message = buildMessage(event, config);
  if (!message) {
    process.exit(0);
  }

  if (!isTestMode) {
    // Min duration check (only for Stop events — quick interactions don't need notifications)
    const minDuration = config.min_duration_seconds;
    if (minDuration && minDuration > 0 && hookEvent === "Stop") {
      if (message.durationMs != null && message.durationMs < minDuration * 1000) {
        process.exit(0);
      }
    }

    // Filter channels by per-channel event settings
    const eventKey = EVENT_KEY_MAP[hookEvent];
    channelConfigs = (config.channels || []).filter((ch) =>
      channelAcceptsEvent(ch, eventKey)
    );

    if (channelConfigs.length === 0) {
      process.exit(0);
    }

    // Update cooldown timestamp
    updateCooldown();
  }

  // Send to all matching channels concurrently
  const results = await Promise.allSettled(
    channelConfigs.map(async (ch) => {
      const impl = channels[ch.type];
      if (!impl) {
        throw new Error(`Unknown channel type: ${ch.type}`);
      }
      return impl.send(ch, message);
    })
  );

  // Log failures to stderr
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      const chType = channelConfigs[i]?.type || "unknown";
      process.stderr.write(
        `notifier [${chType}]: ${results[i].reason?.message || results[i].reason}\n`
      );
    }
  }

  // Cleanup session timestamp on Stop/SessionEnd
  if ((hookEvent === "Stop" || hookEvent === "SessionEnd") && event.session_id) {
    cleanupSessionTimestamp(event.session_id);
  }
}

main().catch((err) => {
  process.stderr.write(`notifier: ${err.message}\n`);
  process.exit(1);
});
