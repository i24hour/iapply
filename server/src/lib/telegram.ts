// Telegram Bot - Controls the Chrome Extension Agent remotely
import TelegramBot from 'node-telegram-bot-api';
import { pushCommand, onAgentLog, getAgentStatus, getRecentLogs } from './agent-commands.js';
import { getUserById, getUserByTelegramId, countLinkedTelegramUsers } from './supabase.js';
import { createTaskRun, recordUsageEvent, stopOpenTasksForUser } from './usage-tracking.js';

let bot: TelegramBot | null = null;

function isLocalUrl(url?: string) {
  return !!url && (url.includes('localhost') || url.includes('127.0.0.1'));
}

function getPublicClientUrl() {
  const telegramClientUrl = process.env.TELEGRAM_CLIENT_URL?.trim();
  if (telegramClientUrl) {
    return telegramClientUrl;
  }

  const clientUrl = process.env.CLIENT_URL?.trim();
  if (clientUrl && !isLocalUrl(clientUrl)) {
    return clientUrl;
  }

  return 'https://iapply.onrender.com';
}

function getTelegramLoginUrl(chatId: number) {
  const clientUrl = getPublicClientUrl();
  return `${clientUrl}/login?telegram_id=${chatId}`;
}

function sendSignInPrompt(chatId: number, text = '🔒 Please sign in first!') {
  if (!bot) return;

  bot.sendMessage(
    chatId,
    `${text}\n\nTap the button below to continue.`,
    {
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: 'Sign In', url: getTelegramLoginUrl(chatId) }]],
      },
    }
  ).catch(console.error);
}

export async function refreshBotProfile() {
  if (!bot) return;

  try {
    const linkedUsers = await countLinkedTelegramUsers();
    const shortDescription =
      linkedUsers > 0
        ? `${linkedUsers} verified users linked`
        : 'Link your account and control iApply from Telegram';
    const description =
      linkedUsers > 0
        ? `Automate your job search with iApply. Currently ${linkedUsers} verified users have linked their Telegram accounts.`
        : 'Automate your job search with iApply. Link your account to control your agent from Telegram.';

    await bot.setMyShortDescription({ short_description: shortDescription });
    await bot.setMyDescription({ description });
  } catch (error) {
    console.error('Failed to refresh bot profile metadata:', error);
  }
}

export function startTelegramBot(token: string) {
  if (!token || token === 'your-telegram-bot-token') {
    console.log('⚠️  No Telegram bot token set. Skipping Telegram integration.');
    return;
  }

  bot = new TelegramBot(token, { polling: true });
  console.log('🤖 Telegram Bot started! Send /help to your bot.');
  refreshBotProfile().catch(console.error);

  // /start command
  bot.onText(/\/start(.*)/, async (msg, match) => {
    const param = match![1].trim();

    if (param === 'success') {
      const user = await getLinkedUser(msg.chat.id);
      if (!user) {
        sendSignInPrompt(msg.chat.id, '⚠️ Sign-in completed but account linking is still pending.');
        return;
      }

      bot!.sendMessage(msg.chat.id,
        `🎉 *Authentication Successful!*\n\n` +
        `Welcome to iApply! Your account is now securely linked.\n` +
        `You can now control your agent. Try: \`/apply Software Engineer\``,
        { parse_mode: 'Markdown' }
      ).catch(console.error);
      refreshBotProfile().catch(console.error);
      return;
    }

    bot!.sendMessage(msg.chat.id,
      `🚀 *iApply Agent Bot*\n\n` +
      `Welcome! To get started, you need to authenticate securely.\n\n` +
      `After signing in, you'll be automatically redirected back here!`,
      {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: 'Sign In', url: getTelegramLoginUrl(msg.chat.id) }]],
        },
      }
    ).catch(console.error);
  });

  // Helper: check if this chat ID is authorized
  async function getLinkedUser(chatId: number) {
    return getUserByTelegramId(chatId);
  }

  // /apply command — starts the agent
  bot.onText(/\/apply (.+)/, async (msg, match) => {
    const user = await getLinkedUser(msg.chat.id);
    if (!user) {
      sendSignInPrompt(msg.chat.id);
      return;
    }

    const query = match![1].trim();
    if (!query) {
      bot!.sendMessage(msg.chat.id, '❌ Please provide a job query.\nExample: `/apply Product Manager`', { parse_mode: 'Markdown' }).catch(console.error);
      return;
    }

    const taskRun = user.email
      ? await createTaskRun({
          userId: user.id,
          userEmail: user.email,
          source: 'telegram',
          channel: 'telegram_bot',
          commandText: `/apply ${query}`,
          metadata: { telegram_chat_id: msg.chat.id },
        })
      : null;

    const cmd = pushCommand({
      userId: user.id,
      type: 'start_agent',
      payload: {
        searchQuery: query,
        provider: 'gemini',
        apiKey: process.env.GEMINI_API_KEY || '',
        taskId: taskRun?.id || undefined,
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
  bot.onText(/\/stop/, async (msg) => {
    const user = await getLinkedUser(msg.chat.id);
    if (!user) {
      sendSignInPrompt(msg.chat.id);
      return;
    }

    pushCommand({ userId: user.id, type: 'stop_agent', payload: {} });
    await stopOpenTasksForUser(user.id);
    bot!.sendMessage(msg.chat.id, '⏹ *Agent Stop command sent.*\nThe extension will stop after the current step.', { parse_mode: 'Markdown' }).catch(console.error);
  });

  // /status command
  bot.onText(/\/status/, async (msg) => {
    const user = await getLinkedUser(msg.chat.id);
    if (!user) {
      sendSignInPrompt(msg.chat.id, '🔒 Please link your account first.');
      return;
    }

    const status = getAgentStatus(user.id);
    const emoji = status === 'running' ? '🟢' : status === 'error' ? '🔴' : '⚪';
    bot!.sendMessage(msg.chat.id, `${emoji} Agent Status: *${status.toUpperCase()}*`, { parse_mode: 'Markdown' }).catch(console.error);
  });

  // /whoami command
  bot.onText(/\/whoami/, async (msg) => {
    const user = await getUserByTelegramId(msg.chat.id);

    if (user) {
      bot!.sendMessage(
        msg.chat.id,
        `✅ *Linked Successfully*\n\n` +
        `• Chat ID: \`${msg.chat.id}\`\n` +
        `• Account: \`${user.email || 'unknown'}\``,
        { parse_mode: 'Markdown' }
      ).catch(console.error);
      return;
    }

    bot!.sendMessage(
      msg.chat.id,
      `❌ *Not Linked Yet*\n\n` +
      `• Chat ID: \`${msg.chat.id}\`\n\n` +
      `Please complete sign-in using the button below.`,
      {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: 'Sign In', url: getTelegramLoginUrl(msg.chat.id) }]],
        },
      }
    ).catch(console.error);
  });

  bot.onText(/\/stats/, async (msg) => {
    const user = await getLinkedUser(msg.chat.id);
    if (!user) {
      sendSignInPrompt(msg.chat.id);
      return;
    }

    try {
      const linkedUsers = await countLinkedTelegramUsers();
      bot!.sendMessage(
        msg.chat.id,
        `📊 *Bot Stats*\n\n👥 Linked users: *${linkedUsers}*`,
        { parse_mode: 'Markdown' }
      ).catch(console.error);
    } catch (error) {
      console.error('Failed to fetch bot stats:', error);
      bot!.sendMessage(msg.chat.id, '⚠️ Could not load bot stats right now.').catch(console.error);
    }
  });

  // /logs command
  bot.onText(/\/logs/, async (msg) => {
    const user = await getLinkedUser(msg.chat.id);
    if (!user) {
      sendSignInPrompt(msg.chat.id, '🔒 Please link your account first.');
      return;
    }

    const logs = getRecentLogs(user.id, 10);
    if (logs.length === 0) {
      bot!.sendMessage(msg.chat.id, '📭 No logs yet.').catch(console.error);
      return;
    }

    const logText = logs.map(l => {
      const time = l.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `\`${time}\` ${l.isError ? '❌' : '▸'} ${l.message}`;
    }).join('\n');

    bot!.sendMessage(msg.chat.id, `📋 *Recent Logs:*\n\n${logText}`, { parse_mode: 'Markdown' }).catch(console.error);
  });

  // /screenshot command
  bot.onText(/\/screenshot/, async (msg) => {
    const user = await getLinkedUser(msg.chat.id);
    if (!user) {
      sendSignInPrompt(msg.chat.id, '🔒 Please link your account first.');
      return;
    }

    pushCommand({ userId: user.id, type: 'request_screenshot', payload: {} });
    bot!.sendMessage(msg.chat.id, '📸 Requesting screenshot from browser...').catch(console.error);
  });

  // /help command
  bot.onText(/\/help/, (msg) => {
    bot!.sendMessage(msg.chat.id,
      `🤖 *iApply Bot Commands:*\n\n` +
      `▸ /apply <query> — Start job search & auto-apply\n` +
      `▸ /stop — Stop the running agent\n` +
      `▸ /screenshot — Capture Chrome browser window\n` +
      `▸ /status — Check if agent is running\n` +
      `▸ /whoami — Check account linking status\n` +
      `▸ /stats — Show linked user count\n` +
      `▸ /logs — View last 10 log entries\n` +
      `▸ /help — Show this help message`,
      { parse_mode: 'Markdown' }
    ).catch(console.error);
  });

  // Conversational Fallback
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const user = await getLinkedUser(msg.chat.id);
    if (!user) {
      sendSignInPrompt(msg.chat.id);
      return;
    }

    // Check if the user is asking for a screenshot colloquially
    const textLower = msg.text.toLowerCase();
    if (textLower.includes('screenshot') || textLower.includes('show me') || textLower.includes('photo')) {
      pushCommand({ userId: user.id, type: 'request_screenshot', payload: {} });
      bot!.sendMessage(msg.chat.id, '📸 Requesting live screenshot...').catch(console.error);
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      bot!.sendMessage(msg.chat.id, '⚠️ Conversational AI is disabled. Please set GEMINI_API_KEY in .env').catch(console.error);
      return;
    }

    try {
      const status = getAgentStatus(user.id);
      const logs = getRecentLogs(user.id, 10).map(l => `[${l.timestamp.toISOString()}] ${l.isError ? 'ERROR: ' : ''}${l.message}`).join('\n');

      const systemPrompt = `You are the iApply Telegram Bot Assistant. You control a Chrome extension autonomously applying to LinkedIn jobs.
Current Agent Status: ${status}
Recent Logs:
${logs}

User Message: ${msg.text}

Respond conversationally to the user about what the agent is currently doing or how you can help. Keep it concise, friendly, and use Telegram markdown. Do NOT invent logs that aren't there. If they ask you to start applying, tell them to use /apply <query>.`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }] }],
          generationConfig: { maxOutputTokens: 250, temperature: 0.7 }
        })
      });

      const data = await response.json() as any;
      const aiResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      const usage = data?.usageMetadata;

      if (user.email && usage) {
        await recordUsageEvent({
          userId: user.id,
          userEmail: user.email,
          taskId: null,
          source: 'telegram',
          channel: 'telegram_bot',
          provider: 'gemini',
          model: 'gemini-2.0-flash-lite',
          inputTokens: Number(usage.promptTokenCount || 0),
          outputTokens: Number(usage.candidatesTokenCount || 0),
          totalTokens: Number(usage.totalTokenCount || 0),
          metadata: {
            kind: 'telegram_assistant_reply',
            prompt_preview: msg.text.slice(0, 120),
          },
        });
      }

      if (aiResponse) {
        bot!.sendMessage(msg.chat.id, aiResponse, { parse_mode: 'Markdown' }).catch(console.error);
      } else {
        bot!.sendMessage(msg.chat.id, '🤔 I am not sure how to respond to that right now.').catch(console.error);
      }
    } catch (error) {
      console.error('Gemini fallback error:', error);
      bot!.sendMessage(msg.chat.id, '⚠️ Sorry, I could not process your message via AI right now.').catch(console.error);
    }
  });

  // Subscribe to live agent logs and forward to Telegram
  onAgentLog(async (log) => {
    if (!bot) return;
    if (log.message.startsWith('Waiting')) return;

    const linkedUser = await getUserById(log.userId);
    const chatId = linkedUser?.telegram_chat_id;
    if (!chatId) return;

    const emoji = log.isError ? '❌' : '▸';
    const time = log.timestamp.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const msgText = log.message.length > 300 ? log.message.slice(0, 300) + '...' : log.message;

    bot.sendMessage(chatId, `\`${time}\` ${emoji} ${msgText}`, { parse_mode: 'Markdown' })
      .catch(() => {});
  });

  bot.on('polling_error', (error) => {
    console.error('Telegram polling error:', error.message);
  });
}

export async function sendTelegramMessage(userId: string, text: string) {
  if (!bot) return;

  const linkedUser = await getUserById(userId);
  if (!linkedUser?.telegram_chat_id) return;

  bot.sendMessage(linkedUser.telegram_chat_id, text, { parse_mode: 'Markdown' }).catch(() => {});
}

export async function sendTelegramPhoto(userId: string, buffer: Buffer) {
  if (!bot) return;

  const linkedUser = await getUserById(userId);
  if (!linkedUser?.telegram_chat_id) return;

  bot.sendPhoto(linkedUser.telegram_chat_id, buffer, { caption: '📸 Live Agent Screenshot' }).catch(() => {});
}
