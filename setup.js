#!/usr/bin/env node

/**
 * Claude Code Notifier — Interactive Setup
 *
 * Usage: node setup.js
 *
 * Guides the user through:
 * 1. Choosing notification channels
 * 2. Entering credentials (webhook URL, token, etc.)
 * 3. Setting preferences (language, quiet hours, min duration)
 * 4. Generating ~/.claude/claude-notifier.json
 * 5. Installing hooks into ~/.claude/settings.json
 */

const readline = require("node:readline");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const CONFIG_PATH = path.join(CLAUDE_DIR, "claude-notifier.json");
const SETTINGS_PATH = path.join(CLAUDE_DIR, "settings.json");
const NOTIFY_SCRIPT = path.resolve(__dirname, "src", "notify.js");

// ─── CLI Helpers ────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, defaultVal) {
  const suffix = defaultVal != null ? ` (${defaultVal})` : "";
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || (defaultVal != null ? String(defaultVal) : ""));
    });
  });
}

function askYesNo(question, defaultYes = true) {
  const hint = defaultYes ? "Y/n" : "y/N";
  return new Promise((resolve) => {
    rl.question(`  ${question} [${hint}]: `, (answer) => {
      const a = answer.trim().toLowerCase();
      if (a === "") resolve(defaultYes);
      else resolve(a === "y" || a === "yes");
    });
  });
}

function print(msg = "") {
  console.log(msg);
}

function printHeader(msg) {
  print();
  print(`── ${msg} ──`);
  print();
}

// ─── Channel Setup ──────────────────────────────────────────────

const CHANNEL_MENU = [
  { key: "1", type: "feishu", name: "飞书 / Feishu", desc: "群机器人 webhook" },
  { key: "2", type: "dingtalk", name: "钉钉 / DingTalk", desc: "群机器人 webhook" },
  { key: "3", type: "wecom", name: "企业微信 / WeCom", desc: "群机器人 webhook" },
  { key: "4", type: "telegram", name: "Telegram", desc: "Bot API" },
  { key: "5", type: "bark", name: "Bark (iOS)", desc: "iPhone 原生推送" },
  { key: "6", type: "serverchan", name: "Server酱 (微信)", desc: "微信公众号推送" },
  { key: "7", type: "email", name: "Email", desc: "SMTP 邮件" },
  { key: "8", type: "webhook", name: "通用 Webhook", desc: "自定义 HTTP 接口" },
];

async function setupFeishu() {
  print("  飞书设置:");
  print("  1. 打开飞书群 → 群设置 → 群机器人 → 添加自定义机器人");
  print("  2. 复制 webhook URL");
  print();
  const url = await ask("Webhook URL");
  if (!url) return null;
  const secret = await ask("签名密钥 (没有就直接回车)", "");
  const ch = { type: "feishu", webhook_url: url };
  if (secret) ch.secret = secret;
  return ch;
}

async function setupDingtalk() {
  print("  钉钉设置:");
  print("  1. 打开钉钉群 → 群设置 → 智能群助手 → 添加自定义机器人");
  print("  2. 安全设置选择「加签」，复制 webhook URL 和 secret");
  print();
  const url = await ask("Webhook URL");
  if (!url) return null;
  const secret = await ask("签名密钥 (加签模式必填)");
  const ch = { type: "dingtalk", webhook_url: url };
  if (secret) ch.secret = secret;
  return ch;
}

async function setupWecom() {
  print("  企业微信设置:");
  print("  1. 打开企业微信群 → 添加群机器人");
  print("  2. 复制 webhook URL");
  print();
  const url = await ask("Webhook URL");
  if (!url) return null;
  return { type: "wecom", webhook_url: url };
}

async function setupTelegram() {
  print("  Telegram 设置:");
  print("  1. 找 @BotFather 发 /newbot 创建机器人，获取 token");
  print("  2. 给机器人发消息，访问 https://api.telegram.org/bot<TOKEN>/getUpdates 获取 chat_id");
  print();
  const token = await ask("Bot Token");
  if (!token) return null;
  const chatId = await ask("Chat ID");
  if (!chatId) return null;
  return { type: "telegram", bot_token: token, chat_id: chatId };
}

async function setupBark() {
  print("  Bark 设置 (iOS):");
  print("  1. App Store 搜索 Bark 安装");
  print("  2. 打开 App 复制 Device Key");
  print();
  const key = await ask("Device Key");
  if (!key) return null;
  const server = await ask("Server URL", "https://api.day.app");
  return { type: "bark", device_key: key, server_url: server };
}

async function setupServerchan() {
  print("  Server酱设置 (微信推送):");
  print("  1. 访问 https://sct.ftqq.com 用 GitHub 登录");
  print("  2. 获取 SendKey");
  print("  3. 微信扫码关注「方糖」公众号");
  print();
  const key = await ask("SendKey");
  if (!key) return null;
  return { type: "serverchan", key };
}

async function setupEmail() {
  print("  邮件设置:");
  print("  常见 SMTP: smtp.qq.com (465) / smtp.gmail.com (465) / smtp.163.com (465)");
  print();
  const host = await ask("SMTP 服务器", "smtp.qq.com");
  const port = parseInt(await ask("SMTP 端口", "465"));
  const username = await ask("用户名 (邮箱地址)");
  if (!username) return null;
  const password = await ask("密码 / 授权码");
  if (!password) return null;
  const to = await ask("收件邮箱", username);
  return {
    type: "email",
    smtp_host: host,
    smtp_port: port,
    username,
    password,
    from: username,
    to,
  };
}

async function setupWebhook() {
  print("  通用 Webhook 设置:");
  print();
  const url = await ask("Webhook URL");
  if (!url) return null;
  const secret = await ask("HMAC 签名密钥 (可选)", "");
  const ch = { type: "webhook", webhook_url: url };
  if (secret) ch.secret = secret;
  return ch;
}

const SETUP_FNS = {
  feishu: setupFeishu,
  dingtalk: setupDingtalk,
  wecom: setupWecom,
  telegram: setupTelegram,
  bark: setupBark,
  serverchan: setupServerchan,
  email: setupEmail,
  webhook: setupWebhook,
};

// ─── Hooks Installation ─────────────────────────────────────────

function makeHookEntry() {
  return [
    {
      hooks: [
        {
          type: "command",
          command: `node ${NOTIFY_SCRIPT}`,
          timeout: 30,
          async: true,
        },
      ],
    },
  ];
}

function installHooks() {
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {}

  if (!settings.hooks) settings.hooks = {};

  const events = ["SessionStart", "Stop", "Notification", "TaskCompleted", "SubagentStop"];
  let alreadyInstalled = 0;

  for (const event of events) {
    const existing = settings.hooks[event] || [];
    // Check if our hook is already there
    const hasOurs = existing.some((group) =>
      group.hooks?.some((h) => h.command?.includes("claude-code-notifier") || h.command?.includes("notify.js"))
    );
    if (hasOurs) {
      alreadyInstalled++;
      continue;
    }

    const entry = makeHookEntry();
    // SessionStart needs shorter timeout
    if (event === "SessionStart") {
      entry[0].hooks[0].timeout = 5;
    }

    settings.hooks[event] = [...existing, ...entry];
  }

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
  return alreadyInstalled === events.length ? "already" : "installed";
}

function uninstallHooks() {
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
  } catch {
    return;
  }

  if (!settings.hooks) return;

  for (const event of Object.keys(settings.hooks)) {
    settings.hooks[event] = settings.hooks[event].filter(
      (group) => !group.hooks?.some((h) => h.command?.includes("claude-code-notifier") || h.command?.includes("notify.js"))
    );
    if (settings.hooks[event].length === 0) {
      delete settings.hooks[event];
    }
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
}

// ─── Test Notification ──────────────────────────────────────────

async function testNotification(config) {
  const { spawnSync } = require("child_process");

  // Save a fake session start (2 minutes ago) for duration display
  const stateDir = path.join(os.tmpdir(), "claude-code-notifier");
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "session-setup-test.ts"), (Date.now() - 120000).toString());
  } catch {}

  const event = {
    hook_event_name: "Stop",
    session_id: "setup-test",
    cwd: process.cwd(),
    last_assistant_message: "Setup complete! This is a test notification from claude-code-notifier.",
  };

  const cfgPath = path.join(os.tmpdir(), "notifier-setup-test.json");
  fs.writeFileSync(cfgPath, JSON.stringify({ ...config, cooldown_seconds: 0 }));

  const r = spawnSync("/bin/bash", ["-c",
    `echo '${JSON.stringify(event)}' | node ${NOTIFY_SCRIPT}`
  ], {
    timeout: 15000,
    env: { ...process.env, CLAUDE_NOTIFIER_CONFIG: cfgPath },
  });

  try { fs.unlinkSync(cfgPath); } catch {}

  const stderr = r.stderr?.toString() || "";
  if (stderr) {
    print(`  ⚠ 部分渠道发送失败: ${stderr.trim()}`);
    return false;
  }
  return true;
}

// ─── Main Flow ──────────────────────────────────────────────────

async function main() {
  print();
  print("╔══════════════════════════════════════════╗");
  print("║     Claude Code Notifier Setup           ║");
  print("║     任务完成通知 · 一键配置              ║");
  print("╚══════════════════════════════════════════╝");

  // Check for existing config
  if (fs.existsSync(CONFIG_PATH)) {
    print();
    print(`  已检测到配置文件: ${CONFIG_PATH}`);
    const overwrite = await askYesNo("是否重新配置?", false);
    if (!overwrite) {
      const justInstall = await askYesNo("只安装/更新 hooks 到 settings.json?", true);
      if (justInstall) {
        const result = installHooks();
        print(result === "already" ? "  Hooks 已经安装过了" : "  ✓ Hooks 已安装");
        rl.close();
        return;
      }
      print("  退出");
      rl.close();
      return;
    }
  }

  // ── Step 1: Choose channels ──
  printHeader("Step 1/3 · 选择通知渠道");
  print("  可以选择多个，用逗号分隔 (例如: 1,4,5)");
  print();
  for (const ch of CHANNEL_MENU) {
    print(`  ${ch.key}. ${ch.name} — ${ch.desc}`);
  }
  print();

  const choices = await ask("选择渠道");
  const selectedKeys = choices.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
  const selectedChannels = selectedKeys
    .map((k) => CHANNEL_MENU.find((m) => m.key === k))
    .filter(Boolean);

  if (selectedChannels.length === 0) {
    print("  未选择任何渠道，退出");
    rl.close();
    return;
  }

  print(`\n  已选择: ${selectedChannels.map((c) => c.name).join(", ")}`);

  // ── Step 2: Configure each channel ──
  const channelConfigs = [];
  for (const sel of selectedChannels) {
    printHeader(`配置 ${sel.name}`);
    const setupFn = SETUP_FNS[sel.type];
    const ch = await setupFn();
    if (ch) {
      channelConfigs.push(ch);
      print(`  ✓ ${sel.name} 配置完成`);
    } else {
      print(`  ✗ ${sel.name} 已跳过`);
    }
  }

  if (channelConfigs.length === 0) {
    print("\n  没有配置任何渠道，退出");
    rl.close();
    return;
  }

  // ── Step 3: Preferences ──
  printHeader("Step 3/3 · 偏好设置");

  const lang = await ask("通知语言 (zh=中文, en=English)", "zh");

  const minDuration = parseInt(await ask("最小任务时长 (秒, 低于此时长不通知)", "30"));

  const quietEnabled = await askYesNo("启用免打扰时段?", true);
  let quietHours = { enabled: false };
  if (quietEnabled) {
    const start = await ask("免打扰开始时间", "23:00");
    const end = await ask("免打扰结束时间", "08:00");
    quietHours = { enabled: true, start, end };
  }

  // ── Build config ──
  const config = {
    enabled: true,
    language: lang,
    min_duration_seconds: minDuration,
    cooldown_seconds: 10,
    quiet_hours: quietHours,
    events: {
      stop: true,
      notification: true,
      task_completed: true,
      subagent_stop: false,
    },
    channels: channelConfigs,
  };

  // ── Save config ──
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  print(`\n  ✓ 配置已保存到 ${CONFIG_PATH}`);

  // ── Install hooks ──
  const hookResult = installHooks();
  print(hookResult === "already"
    ? "  ✓ Hooks 已经安装过了 (settings.json)"
    : "  ✓ Hooks 已安装到 ~/.claude/settings.json"
  );

  // ── Test ──
  print();
  const doTest = await askYesNo("发送一条测试通知?", true);
  if (doTest) {
    print("  发送中...");
    const ok = await testNotification(config);
    if (ok) {
      print("  ✓ 测试通知发送成功! 请检查你的手机/App");
    }
  }

  // ── Done ──
  print();
  print("╔══════════════════════════════════════════╗");
  print("║  ✓ 安装完成!                             ║");
  print("║                                          ║");
  print("║  下次启动 Claude Code 即自动生效          ║");
  print("║  配置文件: ~/.claude/claude-notifier.json ║");
  print("║                                          ║");
  print("║  卸载: node setup.js --uninstall          ║");
  print("╚══════════════════════════════════════════╝");
  print();

  rl.close();
}

// ─── Uninstall ──────────────────────────────────────────────────

function handleUninstall() {
  print();
  print("卸载 Claude Code Notifier...");

  uninstallHooks();
  print("  ✓ Hooks 已从 settings.json 移除");

  if (fs.existsSync(CONFIG_PATH)) {
    fs.unlinkSync(CONFIG_PATH);
    print("  ✓ 配置文件已删除");
  }

  // Cleanup state
  const stateDir = path.join(os.tmpdir(), "claude-code-notifier");
  try {
    fs.rmSync(stateDir, { recursive: true });
  } catch {}

  print("  ✓ 卸载完成");
  print();
}

// ─── Entry ──────────────────────────────────────────────────────

if (process.argv.includes("--uninstall") || process.argv.includes("uninstall")) {
  handleUninstall();
} else {
  main().catch((err) => {
    console.error("Setup error:", err.message);
    rl.close();
    process.exit(1);
  });
}
