# Claude Code Notifier

[English](#english) | [中文](#中文)

> Get notified on your phone when Claude Code finishes a task, needs authorization, or is waiting for input.

Supports **8 notification channels**: Feishu, DingTalk, WeCom, Telegram, Bark (iOS), ServerChan (WeChat), Email, and custom Webhooks.

**Zero dependencies** — only Node.js 18+ built-ins.

---

## English

### Features

- **8 Channels** — Feishu, DingTalk, WeCom, Telegram, Bark, ServerChan, Email, Webhook
- **Smart Filtering** — Skip short tasks, rate limit notifications, quiet hours
- **Per-Channel Events** — Each channel can subscribe to different event types
- **Duration Tracking** — Shows how long each task took
- **i18n** — Chinese and English
- **Zero Dependencies** — No `npm install` needed, runs on Node.js built-ins
- **Async & Non-blocking** — Never slows down Claude Code

### Quick Start

**Option A: Plugin Marketplace (Recommended)**

```bash
# In Claude Code, add this repo as a marketplace source
/plugin marketplace add kevinWangSheng/claude-code-notifier

# Install the plugin
/plugin install claude-code-notifier
```

Then create your config file:

```bash
cp ~/.claude/plugins/cache/claude-code-notifier/config.example.json ~/.claude/claude-notifier.json
# Edit ~/.claude/claude-notifier.json with your webhook URLs
```

**Option B: Git Clone + Interactive Setup**

```bash
git clone https://github.com/kevinWangSheng/claude-code-notifier.git
cd claude-code-notifier
node setup.js
```

The setup wizard guides you through channel selection, credential entry, and preference configuration. It automatically installs hooks and sends a test notification.

**Option C: Git Clone + Manual Config**

```bash
git clone https://github.com/kevinWangSheng/claude-code-notifier.git
cd claude-code-notifier

# Copy and edit config
cp config.example.json ~/.claude/claude-notifier.json
# Edit ~/.claude/claude-notifier.json — add your webhook URLs, remove unused channels

# Install hooks (run once inside Claude Code)
claude --plugin-dir /path/to/claude-code-notifier
```

Or manually add hooks to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/claude-code-notifier/src/notify.js",
            "timeout": 30,
            "async": true
          }
        ]
      }
    ]
  }
}
```

### Supported Channels

| Channel | Type | Setup |
|---------|------|-------|
| Feishu / Lark | `feishu` | Group bot webhook ([docs](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)) |
| DingTalk | `dingtalk` | Group bot webhook ([docs](https://open.dingtalk.com/document/orgapp/custom-robots-send-group-messages)) |
| WeCom | `wecom` | Group bot webhook ([docs](https://developer.work.weixin.qq.com/document/path/91770)) |
| Telegram | `telegram` | Bot API ([create bot](https://t.me/BotFather)) |
| Bark (iOS) | `bark` | iOS app push ([App Store](https://apps.apple.com/app/bark/id1403753865)) |
| ServerChan | `serverchan` | WeChat push ([sct.ftqq.com](https://sct.ftqq.com)) |
| Email | `email` | SMTP (Gmail, QQ Mail, Outlook, etc.) |
| Webhook | `webhook` | Any HTTP endpoint with optional HMAC-SHA256 signing |

### Configuration

Config file location (searched in order):
1. `$CLAUDE_NOTIFIER_CONFIG` environment variable
2. `$PROJECT/.claude/claude-notifier.json` (project-level)
3. `~/.claude/claude-notifier.json` (user-level)

#### Minimal Config (Feishu)

```json
{
  "enabled": true,
  "channels": [
    {
      "type": "feishu",
      "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/YOUR_TOKEN"
    }
  ]
}
```

#### Full Config

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
    {
      "type": "feishu",
      "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/YOUR_TOKEN",
      "secret": "YOUR_SECRET_OR_REMOVE",
      "events": ["stop", "notification"]
    },
    {
      "type": "telegram",
      "bot_token": "123456:ABC-DEF",
      "chat_id": "YOUR_CHAT_ID"
    },
    {
      "type": "bark",
      "device_key": "YOUR_KEY",
      "server_url": "https://api.day.app"
    },
    {
      "type": "email",
      "smtp_host": "smtp.gmail.com",
      "smtp_port": 465,
      "username": "you@gmail.com",
      "password": "your-app-password",
      "from": "you@gmail.com",
      "to": "you@gmail.com",
      "events": ["notification"]
    }
  ]
}
```

#### Config Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Master switch |
| `language` | string | `"zh"` | `"zh"` (Chinese) or `"en"` (English) |
| `min_duration_seconds` | number | `0` | Skip notifications for tasks shorter than this (only applies to Stop events) |
| `cooldown_seconds` | number | `0` | Minimum seconds between notifications |
| `quiet_hours.enabled` | boolean | `false` | Enable do-not-disturb window |
| `quiet_hours.start` | string | `"23:00"` | DND start time (HH:MM) |
| `quiet_hours.end` | string | `"08:00"` | DND end time (HH:MM, supports cross-midnight) |
| `events.stop` | boolean | `true` | Notify on task completion |
| `events.notification` | boolean | `true` | Notify on permission/idle prompts |
| `events.task_completed` | boolean | `true` | Notify on team task completion |
| `events.subagent_stop` | boolean | `false` | Notify on subagent completion |

#### Per-Channel Event Filtering

Each channel can have an `events` array to only receive specific event types:

```json
{
  "type": "email",
  "events": ["notification"],
  "smtp_host": "...",
  "...": "..."
}
```

If `events` is omitted, the channel receives all globally-enabled events.

### Events

| Event | When | Use Case |
|-------|------|----------|
| `Stop` | Claude finishes a response | Know when long tasks complete |
| `Notification` | Permission prompt or idle | Get alerted to authorize actions |
| `TaskCompleted` | Team task done | Track agent team progress |
| `SubagentStop` | Subagent finishes | Detailed team monitoring |
| `SessionStart` | Session begins | Internal — used for duration tracking |

### Uninstall

```bash
# If installed via setup.js
node setup.js --uninstall

# If installed as plugin
/plugin uninstall claude-code-notifier
```

### Running Tests

```bash
node test/test-format.js      # 84 tests — message formatting & signatures
node test/test-features.js    # 23 tests — filtering, cooldown, quiet hours, i18n
```

---

## 中文

### 功能特性

- **8 种通知渠道** — 飞书、钉钉、企业微信、Telegram、Bark、Server酱、邮件、自定义 Webhook
- **智能过滤** — 跳过短任务、通知频率限制、免打扰时段
- **按渠道订阅** — 每个渠道可以只接收特定类型的事件
- **任务耗时** — 显示每个任务执行了多长时间
- **中英文** — 支持中文和英文通知
- **零依赖** — 不需要 `npm install`，只用 Node.js 内置模块
- **异步无阻塞** — 不会影响 Claude Code 速度

### 快速开始

**方式一：插件市场安装（推荐）**

在 Claude Code 中执行：

```bash
# 添加插件市场
/plugin marketplace add kevinWangSheng/claude-code-notifier

# 安装插件
/plugin install claude-code-notifier
```

然后创建配置文件：

```bash
cp ~/.claude/plugins/cache/claude-code-notifier/config.example.json ~/.claude/claude-notifier.json
# 编辑 ~/.claude/claude-notifier.json，填入你的 webhook 地址
```

**方式二：克隆 + 交互式安装**

```bash
git clone https://github.com/kevinWangSheng/claude-code-notifier.git
cd claude-code-notifier
node setup.js
```

安装向导会引导你选择渠道、输入凭据、配置偏好，自动安装 hooks 并发送测试通知。

**方式三：克隆 + 手动配置**

```bash
git clone https://github.com/kevinWangSheng/claude-code-notifier.git
cd claude-code-notifier

# 复制并编辑配置
cp config.example.json ~/.claude/claude-notifier.json
# 编辑 ~/.claude/claude-notifier.json — 填入你的 webhook 地址，删除不需要的渠道

# 安装 hooks（在 Claude Code 中执行一次）
claude --plugin-dir /path/to/claude-code-notifier
```

或者手动添加 hooks 到 `~/.claude/settings.json`：

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /path/to/claude-code-notifier/src/notify.js",
            "timeout": 30,
            "async": true
          }
        ]
      }
    ]
  }
}
```

### 支持的渠道

| 渠道 | 类型 | 说明 |
|------|------|------|
| 飞书 | `feishu` | 群机器人 webhook，支持签名验证，卡片消息 |
| 钉钉 | `dingtalk` | 群机器人 webhook，支持加签，ActionCard 消息 |
| 企业微信 | `wecom` | 群机器人 webhook，Markdown 消息 |
| Telegram | `telegram` | Bot API，支持 Markdown 格式 |
| Bark | `bark` | iOS 原生推送，支持自建服务器 |
| Server酱 | `serverchan` | 微信公众号推送 |
| 邮件 | `email` | SMTP 发送，支持 SSL/TLS 和 STARTTLS |
| 自定义 Webhook | `webhook` | 任意 HTTP 接口，支持 HMAC-SHA256 签名 |

### 各渠道配置

<details>
<summary><b>飞书 (Feishu)</b></summary>

1. 打开飞书群 → 群设置 → 群机器人 → 添加自定义机器人
2. 复制 webhook URL
3. （可选）开启签名验证，复制密钥

```json
{
  "type": "feishu",
  "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/YOUR_TOKEN",
  "secret": "签名密钥（可选）"
}
```
</details>

<details>
<summary><b>钉钉 (DingTalk)</b></summary>

1. 打开钉钉群 → 群设置 → 智能群助手 → 添加自定义机器人
2. 安全设置选择「加签」
3. 复制 webhook URL 和 secret

```json
{
  "type": "dingtalk",
  "webhook_url": "https://oapi.dingtalk.com/robot/send?access_token=YOUR_TOKEN",
  "secret": "加签密钥"
}
```
</details>

<details>
<summary><b>企业微信 (WeCom)</b></summary>

1. 打开企业微信群 → 添加群机器人
2. 复制 webhook URL

```json
{
  "type": "wecom",
  "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_KEY"
}
```
</details>

<details>
<summary><b>Telegram</b></summary>

1. 找 [@BotFather](https://t.me/BotFather) 发 `/newbot` 创建机器人，获取 token
2. 给机器人发一条消息
3. 访问 `https://api.telegram.org/bot<TOKEN>/getUpdates` 获取 chat_id

```json
{
  "type": "telegram",
  "bot_token": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
  "chat_id": "YOUR_CHAT_ID"
}
```
</details>

<details>
<summary><b>Bark (iOS)</b></summary>

1. App Store 搜索 [Bark](https://apps.apple.com/app/bark/id1403753865) 安装
2. 打开 App 复制 Device Key

```json
{
  "type": "bark",
  "device_key": "YOUR_DEVICE_KEY",
  "server_url": "https://api.day.app"
}
```
</details>

<details>
<summary><b>Server酱 (微信推送)</b></summary>

1. 访问 [sct.ftqq.com](https://sct.ftqq.com) 用 GitHub 登录
2. 获取 SendKey
3. 微信扫码关注「方糖」公众号

```json
{
  "type": "serverchan",
  "key": "YOUR_SENDKEY"
}
```
</details>

<details>
<summary><b>邮件 (Email)</b></summary>

常见 SMTP 服务器：
- QQ 邮箱：`smtp.qq.com:465`（需要[开启授权码](https://service.mail.qq.com/detail/0/75)）
- Gmail：`smtp.gmail.com:465`（需要 [App Password](https://myaccount.google.com/apppasswords)）
- 163 邮箱：`smtp.163.com:465`

```json
{
  "type": "email",
  "smtp_host": "smtp.qq.com",
  "smtp_port": 465,
  "username": "your@qq.com",
  "password": "你的授权码",
  "from": "your@qq.com",
  "to": "your@qq.com"
}
```
</details>

<details>
<summary><b>自定义 Webhook</b></summary>

发送 JSON POST 请求到任意 HTTP 接口，支持 HMAC-SHA256 签名（兼容 [Standard Webhooks](https://www.standardwebhooks.com/) 规范）。

```json
{
  "type": "webhook",
  "webhook_url": "https://your-server.com/hooks/claude",
  "secret": "HMAC签名密钥（可选）",
  "headers": {
    "X-Custom-Header": "value"
  }
}
```

Payload 格式：

```json
{
  "type": "claude_code.Stop",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "data": {
    "title": "Claude Code 任务完成",
    "status": "success",
    "project": "my-project",
    "branch": "main",
    "host": "my-macbook",
    "summary": "已完成所有修改..."
  }
}
```
</details>

### 配置参考

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 总开关 |
| `language` | string | `"zh"` | `"zh"` 中文 / `"en"` 英文 |
| `min_duration_seconds` | number | `0` | 任务最短时长（秒），低于此时长不通知（仅对 Stop 事件生效） |
| `cooldown_seconds` | number | `0` | 两次通知最小间隔（秒） |
| `quiet_hours.enabled` | boolean | `false` | 免打扰开关 |
| `quiet_hours.start` | string | `"23:00"` | 免打扰开始时间（支持跨午夜） |
| `quiet_hours.end` | string | `"08:00"` | 免打扰结束时间 |
| `events.stop` | boolean | `true` | 任务完成时通知 |
| `events.notification` | boolean | `true` | 权限请求/等待输入时通知 |
| `events.task_completed` | boolean | `true` | 团队任务完成时通知 |
| `events.subagent_stop` | boolean | `false` | 子代理完成时通知 |

### 卸载

```bash
# 交互式安装的卸载
node setup.js --uninstall

# 插件方式安装的卸载
/plugin uninstall claude-code-notifier
```

### 测试

```bash
node test/test-format.js      # 84 项 — 消息格式和签名验证
node test/test-features.js    # 23 项 — 过滤、冷却、免打扰、国际化
```

---

## Project Structure

```
claude-code-notifier/
├── .claude-plugin/
│   ├── plugin.json            # Plugin metadata
│   └── marketplace.json       # Marketplace descriptor
├── hooks/
│   └── hooks.json             # Claude Code hook definitions
├── src/
│   ├── notify.js              # Main entry point
│   ├── config.js              # Config loader
│   └── channels/
│       ├── feishu.js           # Feishu/Lark
│       ├── dingtalk.js         # DingTalk
│       ├── wecom.js            # WeCom
│       ├── telegram.js         # Telegram
│       ├── bark.js             # Bark (iOS)
│       ├── serverchan.js       # ServerChan (WeChat)
│       ├── email.js            # SMTP Email
│       └── webhook.js          # Generic Webhook
├── test/
│   ├── test-format.js          # Format & signature tests
│   └── test-features.js        # Feature tests
├── setup.js                    # Interactive setup wizard
├── config.example.json         # Full config example
└── README.md
```

## License

MIT
