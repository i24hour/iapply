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
    ).catch(console.error);
  });

  // /apply command — starts the agent
  bot.onText(/\/apply (.+)/, (msg, match) => {
    authorizedChatId = msg.chat.id;
    const query = match![1].trim();

    if (!query) {
      bot!.sendMessage(msg.chat.id, '❌ Please provide a job query.\nExample: `/apply Product Manager`', { parse_mode: 'Markdown' }).catch(console.error);
      return;
    }

    const cmd = pushCommand({
      type: 'start_agent',
      payload: { 
        searchQuery: query,
        provider: 'gemini',
        apiKey: process.env.GEMINI_API_KEY || ''
      },
    });

    bot!.sendMessage(msg.chat.id,
      `✅ *Agent Started!*\n\n` +
      `🔍 Searching: _${query}_\n` +
      `📋 Command ID: \`${cmd.id}\`\n\n` +
      `I'll send you live updates as the agent works.\n` +
      `Use /stop to cancel.`,
      { parse_mode: 'Markdown' }
    ).catch(console.error);
  });

  // /stop command
  bot.onText(/\/stop/, (msg) => {
    authorizedChatId = msg.chat.id;

    pushCommand({
      type: 'stop_agent',
      payload: {},
    });

    bot!.sendMessage(msg.chat.id, '⏹ *Agent Stop command sent.*\nThe extension will stop after the current step.', { parse_mode: 'Markdown' }).catch(console.error);
  });

  // /status command
  bot.onText(/\/status/, (msg) => {
    authorizedChatId = msg.chat.id;
    const status = getAgentStatus();
    const emoji = status === 'running' ? '🟢' : status === 'error' ? '🔴' : '⚪';
    bot!.sendMessage(msg.chat.id, `${emoji} Agent Status: *${status.toUpperCase()}*`, { parse_mode: 'Markdown' }).catch(console.error);
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

    bot!.sendMessage(msg.chat.id, `📋 *Recent Logs:*\n\n${logText}`, { parse_mode: 'Markdown' }).catch(console.error);
  });

  // /screenshot command
  bot.onText(/\/screenshot/, (msg) => {
    authorizedChatId = msg.chat.id;
    pushCommand({ type: 'request_screenshot', payload: {} });
    bot!.sendMessage(msg.chat.id, '📸 Requesting screenshot from browser...').catch(console.error);
  });

  // Help command
  bot.onText(/\/help/, (msg) => {
    authorizedChatId = msg.chat.id;
    bot!.sendMessage(msg.chat.id,
      `🤖 *iApply Bot Commands:*\n\n` +
      `▸ /apply <query> — Start job search & auto-apply\n` +
      `▸ /stop — Stop the running agent\n` +
      `▸ /screenshot — Capture Chrome browser window\n` +
      `▸ /status — Check if agent is running\n` +
      `▸ /logs — View last 10 log entries\n` +
      `▸ /help — Show this help message`,
      { parse_mode: 'Markdown' }
    ).catch(console.error);
  });

  // Conversational Fallback - Any message that doesn't start with '/'
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    authorizedChatId = msg.chat.id;

    // Check if the user is asking for a screenshot colloquially
    const textLower = msg.text.toLowerCase();
    if (textLower.includes('screenshot') || textLower.includes('show me') || textLower.includes('photo')) {
      pushCommand({ type: 'request_screenshot', payload: {} });
      bot!.sendMessage(msg.chat.id, '📸 Requesting live screenshot...');
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      bot!.sendMessage(msg.chat.id, '⚠️ Conversational AI is disabled. Please set GEMINI_API_KEY in .env');
      return;
    }

    try {
      const status = getAgentStatus();
      const logs = getRecentLogs(10).map(l => `[${l.timestamp.toISOString()}] ${l.isError ? 'ERROR: ' : ''}${l.message}`).join('\n');

      const systemPrompt = `You are the iApply Telegram Bot Assistant. You control a Chrome extension autonomously applying to LinkedIn jobs.
Current Agent Status: ${status}
Recent Logs:
${logs}

User Message: ${msg.text}

Respond conversationally to the user about what the agent is currently doing or how you can help. Keep it concise, friendly, and use Telegram markdown. Do NOT invent logs that aren't there. If they ask you to start applying, tell them to use /apply <query>.`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }] }],
          generationConfig: { maxOutputTokens: 250, temperature: 0.7 }
        })
      });

      const data = await response.json() as any;
      const aiResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (aiResponse) {
        bot!.sendMessage(msg.chat.id, aiResponse, { parse_mode: 'Markdown' });
      } else {
        bot!.sendMessage(msg.chat.id, '🤔 I am not sure how to respond to that right now.');
      }
    } catch (error) {
      console.error('Gemini fallback error:', error);
      bot!.sendMessage(msg.chat.id, '⚠️ Sorry, I could not process your message via AI right now.');
    }
  });

  // Subscribe to live agent logs and forward to Telegram
  onAgentLog((log) => {
    if (!bot || !authorizedChatId) return;
    if (log.message.startsWith('Waiting')) return;
    
    const emoji = log.isError ? '❌' : '▸';
    const time = log.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const msgText = log.message.length > 300 ? log.message.slice(0, 300) + '...' : log.message;
    
    bot.sendMessage(authorizedChatId, `\`${time}\` ${emoji} ${msgText}`, { parse_mode: 'Markdown' })
      .catch(() => {});
  });

  bot.on('polling_error', (error) => {
    console.error('Telegram polling error:', error.message);
  });
}

export function sendTelegramMessage(text: string) {
  if (bot && authorizedChatId) {
    bot.sendMessage(authorizedChatId, text, { parse_mode: 'Markdown' }).catch(() => {});
  }
}

export function sendTelegramPhoto(buffer: Buffer) {
  if (bot && authorizedChatId) {
    bot.sendPhoto(authorizedChatId, buffer, { caption: '📸 Live Agent Screenshot' }).catch(() => {});
  }
}

