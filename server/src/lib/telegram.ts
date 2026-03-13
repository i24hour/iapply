// Telegram Bot - Controls the Chrome Extension Agent remotely
import TelegramBot from 'node-telegram-bot-api';
import { pushCommand, onAgentLog, getAgentStatus, getRecentLogs } from './agent-commands.js';

let bot: TelegramBot | null = null;
let authorizedChatId: number | null = null;

export function startTelegramBot(token: string) {
  if (!token || token === 'your-telegram-bot-token') {
    console.log('⚠️  No Telegram bot token set. Skipping Telegram integration.');
    return;
  }

  bot = new TelegramBot(token, { polling: true });
  console.log('🤖 Telegram Bot started! Send /help to your bot.');

  // /start command
  bot.onText(/\/start$/, (msg) => {
    authorizedChatId = msg.chat.id;
    bot!.sendMessage(msg.chat.id, 
      `🚀 *iApply Agent Bot*\n\n` +
      `Commands:\n` +
      `▸ /apply <job query> — Start applying\n` +
      `▸ /stop — Stop the agent\n` +
      `▸ /status — Check agent status\n` +
      `▸ /logs — View recent logs\n` +
      `▸ /help — Show this message\n\n` +
      `Example: /apply Frontend Developer`,
      { parse_mode: 'Markdown' }
    );
  });

  // /apply command — starts the agent
  bot.onText(/\/apply (.+)/, (msg, match) => {
    authorizedChatId = msg.chat.id;
    const query = match![1].trim();

    if (!query) {
      bot!.sendMessage(msg.chat.id, '❌ Please provide a job query.\nExample: `/apply Product Manager`', { parse_mode: 'Markdown' });
      return;
    }

    const cmd = pushCommand({
      type: 'start_agent',
      payload: { searchQuery: query },
    });

    bot!.sendMessage(msg.chat.id,
      `✅ *Agent Started!*\n\n` +
      `🔍 Searching: _${query}_\n` +
      `📋 Command ID: \`${cmd.id}\`\n\n` +
      `I'll send you live updates as the agent works.\n` +
      `Use /stop to cancel.`,
      { parse_mode: 'Markdown' }
    );
  });

  // /stop command
  bot.onText(/\/stop/, (msg) => {
    authorizedChatId = msg.chat.id;

    pushCommand({
      type: 'stop_agent',
      payload: {},
    });

    bot!.sendMessage(msg.chat.id, '⏹ *Agent Stop command sent.*\nThe extension will stop after the current step.', { parse_mode: 'Markdown' });
  });

  // /status command
  bot.onText(/\/status/, (msg) => {
    authorizedChatId = msg.chat.id;
    const status = getAgentStatus();
    const emoji = status === 'running' ? '🟢' : status === 'error' ? '🔴' : '⚪';
    bot!.sendMessage(msg.chat.id, `${emoji} Agent Status: *${status.toUpperCase()}*`, { parse_mode: 'Markdown' });
  });

  // /logs command
  bot.onText(/\/logs/, (msg) => {
    authorizedChatId = msg.chat.id;
    const logs = getRecentLogs(10);
    if (logs.length === 0) {
      bot!.sendMessage(msg.chat.id, '📭 No logs yet.');
      return;
    }

    const logText = logs.map(l => {
      const time = l.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `\`${time}\` ${l.isError ? '❌' : '▸'} ${l.message}`;
    }).join('\n');

    bot!.sendMessage(msg.chat.id, `📋 *Recent Logs:*\n\n${logText}`, { parse_mode: 'Markdown' });
  });

  // /help command
  bot.onText(/\/help/, (msg) => {
    authorizedChatId = msg.chat.id;
    bot!.sendMessage(msg.chat.id,
      `🤖 *iApply Bot Commands:*\n\n` +
      `▸ /apply <query> — Start job search & auto-apply\n` +
      `▸ /stop — Stop the running agent\n` +
      `▸ /status — Check if agent is running\n` +
      `▸ /logs — View last 10 log entries\n` +
      `▸ /help — Show this help message`,
      { parse_mode: 'Markdown' }
    );
  });

  // Subscribe to live agent logs and forward to Telegram
  onAgentLog((log) => {
    if (!bot || !authorizedChatId) return;
    // Throttle: only send important logs (skip "Waiting Xs..." messages)
    if (log.message.startsWith('Waiting')) return;
    
    const emoji = log.isError ? '❌' : '▸';
    const time = log.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    // Truncate long messages for Telegram
    const msg = log.message.length > 300 ? log.message.slice(0, 300) + '...' : log.message;
    
    bot.sendMessage(authorizedChatId, `\`${time}\` ${emoji} ${msg}`, { parse_mode: 'Markdown' })
      .catch(() => {}); // Ignore send errors silently
  });

  // Handle errors
  bot.on('polling_error', (error) => {
    console.error('Telegram polling error:', error.message);
  });
}

export function sendTelegramMessage(text: string) {
  if (bot && authorizedChatId) {
    bot.sendMessage(authorizedChatId, text, { parse_mode: 'Markdown' }).catch(() => {});
  }
}
