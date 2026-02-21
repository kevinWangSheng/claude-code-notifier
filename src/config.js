const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CONFIG_FILENAME = "claude-notifier.json";

/**
 * Load config from multiple locations (higher priority wins):
 * 1. Environment variable CLAUDE_NOTIFIER_CONFIG (path to config file)
 * 2. Project-level: $CWD/.claude/claude-notifier.json
 * 3. User-level: ~/.claude/claude-notifier.json
 */
function loadConfig(cwd) {
  const candidates = [];

  if (process.env.CLAUDE_NOTIFIER_CONFIG) {
    candidates.push(process.env.CLAUDE_NOTIFIER_CONFIG);
  }

  if (cwd) {
    candidates.push(path.join(cwd, ".claude", CONFIG_FILENAME));
  }

  candidates.push(path.join(os.homedir(), ".claude", CONFIG_FILENAME));

  for (const configPath of candidates) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(content);
      config._source = configPath;
      return config;
    } catch {
      // continue to next candidate
    }
  }

  return null;
}

/**
 * Default config structure:
 * {
 *   "enabled": true,
 *   "min_duration_seconds": 30,      // don't notify for quick interactions
 *   "events": {
 *     "stop": true,                   // task completion
 *     "notification": true,           // permission/idle prompts
 *     "task_completed": true,         // team task completed
 *     "subagent_stop": false          // subagent finished
 *   },
 *   "channels": [
 *     {
 *       "type": "wecom",
 *       "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
 *     },
 *     {
 *       "type": "feishu",
 *       "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
 *       "secret": "optional-signing-secret"
 *     },
 *     {
 *       "type": "dingtalk",
 *       "webhook_url": "https://oapi.dingtalk.com/robot/send?access_token=xxx",
 *       "secret": "optional-signing-secret"
 *     },
 *     {
 *       "type": "webhook",
 *       "webhook_url": "https://your-server.com/hooks/claude",
 *       "secret": "optional-hmac-secret",
 *       "headers": {}
 *     }
 *   ]
 * }
 */

module.exports = { loadConfig };
