---
description: Configure Claude Code Notifier — choose channels, enter credentials, set preferences
allowed-tools: Read, Write, Bash, Glob
---

# Claude Code Notifier Setup

You are helping the user configure **claude-code-notifier** — a notification plugin that alerts them when Claude Code completes tasks, needs authorization, or is waiting for input.

## Current State

Check if a config file already exists:
- !`cat ~/.claude/claude-notifier.json 2>/dev/null || echo "NO_CONFIG_FOUND"`

Plugin location:
- !`echo ${CLAUDE_PLUGIN_ROOT:-"not set"}`

## Your Task

Guide the user through configuring their notification channels interactively.

### Step 1: Ask which channels they want

Present the available channels and ask the user to choose (they can pick multiple):

| # | Channel | Best For |
|---|---------|----------|
| 1 | **Feishu / Lark** | Teams using Feishu — group bot webhook, rich card messages |
| 2 | **DingTalk** | Teams using DingTalk — group bot webhook, ActionCard messages |
| 3 | **WeCom** (企业微信) | Teams using WeCom — group bot webhook, Markdown messages |
| 4 | **Telegram** | Personal use — Bot API, private chat messages |
| 5 | **Bark** (iOS) | iPhone users — native iOS push notifications, works on lock screen |
| 6 | **ServerChan** (Server酱) | Personal WeChat — pushes to WeChat via public account |
| 7 | **Email** | Universal — SMTP email with HTML formatting |
| 8 | **Webhook** | Custom integration — any HTTP endpoint with HMAC-SHA256 signing |

### Step 2: Collect credentials for each chosen channel

For each selected channel, ask for the required credentials:

**Feishu**: `webhook_url` (required), `secret` (optional)
- Setup: Open Feishu group → Settings → Bots → Add custom bot → Copy webhook URL

**DingTalk**: `webhook_url` (required), `secret` (required for signed mode)
- Setup: Open DingTalk group → Settings → Smart Assistant → Add custom bot → Security: choose "Sign" mode

**WeCom**: `webhook_url` (required)
- Setup: Open WeCom group → Add bot → Copy webhook URL

**Telegram**: `bot_token` (required), `chat_id` (required)
- Setup: Message @BotFather → /newbot → get token. Then message the bot and visit `https://api.telegram.org/bot<TOKEN>/getUpdates` to get chat_id

**Bark**: `device_key` (required), `server_url` (optional, default `https://api.day.app`)
- Setup: Install Bark from App Store, open app, copy Device Key

**ServerChan**: `key` (required)
- Setup: Visit https://sct.ftqq.com, login with GitHub, get SendKey, follow the WeChat public account

**Email**: `smtp_host`, `smtp_port`, `username`, `password`, `from`, `to` (all required)
- Common SMTP servers: `smtp.qq.com:465` (QQ), `smtp.gmail.com:465` (Gmail), `smtp.163.com:465` (163)
- QQ Mail needs an authorization code (授权码), Gmail needs an App Password

**Webhook**: `webhook_url` (required), `secret` (optional), `headers` (optional)

### Step 3: Ask about preferences

- **Language**: `zh` (Chinese, default) or `en` (English)
- **Min duration**: Only notify for tasks longer than N seconds (default: 30). Quick Q&A won't trigger notifications.
- **Cooldown**: Minimum seconds between notifications (default: 10)
- **Quiet hours**: Enable do-not-disturb? If yes, ask for start/end times (default: 23:00-08:00)

### Step 4: Write the config file

Generate `~/.claude/claude-notifier.json` with the collected information. Use this structure:

```json
{
  "enabled": true,
  "language": "zh",
  "min_duration_seconds": 30,
  "cooldown_seconds": 10,
  "quiet_hours": {
    "enabled": true,
    "start": "23:00",
    "end": "08:00"
  },
  "events": {
    "stop": true,
    "notification": true,
    "task_completed": true,
    "subagent_stop": false
  },
  "channels": [
    { ... }
  ]
}
```

Write the file using the Write tool to `~/.claude/claude-notifier.json`.

### Step 5: Verify and test

After writing the config, offer to send a test notification:

```bash
echo '{"hook_event_name":"Stop","session_id":"setup-test","cwd":"'$(pwd)'","last_assistant_message":"Setup complete! This is a test notification from claude-code-notifier."}' | CLAUDE_NOTIFIER_CONFIG=~/.claude/claude-notifier.json node ${CLAUDE_PLUGIN_ROOT}/src/notify.js
```

If `CLAUDE_PLUGIN_ROOT` is not available, try common locations or ask the user.

## Important Notes

- If a config already exists, ask the user if they want to reconfigure or keep the existing config
- Never store sensitive credentials (passwords, tokens) anywhere except `~/.claude/claude-notifier.json`
- The config file is gitignored by default — it stays local to the user's machine
- Use the user's language preference for the conversation (if they speak Chinese, respond in Chinese)
- $ARGUMENTS
