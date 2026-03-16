// Telegram Bot - Controls the Chrome Extension Agent remotely
import TelegramBot from 'node-telegram-bot-api';
import { pushCommand, onAgentLog, getAgentStatus, getRecentLogs } from './agent-commands.js';
import { getUserById, getUserByTelegramId, countLinkedTelegramUsers, supabase } from './supabase.js';
import { createTaskRun, recordUsageEvent, stopOpenTasksForUser } from './usage-tracking.js';

let bot: TelegramBot | null = null;

type TelegramIntentName =
  | 'apply'
  | 'stop'
  | 'screenshot'
  | 'status'
  | 'usage'
  | 'logs'
  | 'help'
  | 'stats'
  | 'whoami'
  | 'chat';

type TelegramIntent = {
  intent: TelegramIntentName;
  query?: string;
  userGoal?: string;
  reply?: string;
};

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

function stripCodeFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function normalizeApplyQuery(raw: string) {
  let query = String(raw || '').trim();
  if (!query) return '';

  query = query
    .replace(/^[`"'“”]+|[`"'“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  query = query
    .replace(/\b(?:please|now|right now|for me)\b/gi, ' ')
    .replace(/\b(?:but\s+)?(?:with|using|from|based on)\s+my\s+.+$/i, '')
    .replace(/\b(?:with|using|from)\s+(?:the\s+)?uploaded\s+resume.*$/i, '')
    .replace(/\b(?:resume|cv)\b.*$/i, '')
    .replace(/\bjobs?\b$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return query;
}

function extractApplyQuery(text: string) {
  const patterns = [
    /\b(?:please\s+)?apply(?:ing)?\s+(?:for|to)?\s+(.+)/i,
    /\b(?:start|begin|run)\s+(?:applying|apply|job search)\s+(?:for|to)?\s+(.+)/i,
    /\b(?:find|search|look)\s+(?:me\s+)?(?:for\s+)?(.+?)\s+jobs?\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const query = normalizeApplyQuery(match[1]);
    if (query) return query;
  }

  return '';
}

function detectDirectIntent(text: string): TelegramIntent | null {
  const normalized = String(text || '').trim();
  const lower = normalized.toLowerCase();

  const applyQuery = extractApplyQuery(normalized);
  if (applyQuery) {
    return { intent: 'apply', query: applyQuery, userGoal: normalized };
  }

  if (/\b(screenshot|screen shot|show me|show current|photo|snap|capture)\b/i.test(normalized)) {
    return { intent: 'screenshot' };
  }

  if (
    /\b(stop|pause|cancel|halt|abort|end)\b/i.test(normalized) &&
    /\b(apply|agent|automation|search|run|job|process|task|it|this)\b/i.test(normalized)
  ) {
    return { intent: 'stop' };
  }

  if (
    /\b(status|progress|running|idle|stuck|doing)\b/i.test(normalized) ||
    /\bwhat(?:'s| is)\s+(?:the\s+)?(?:status|progress|agent)\b/i.test(normalized) ||
    /\bhow far\b/i.test(normalized)
  ) {
    return { intent: 'status' };
  }

  if (/\b(usage|tokens?|cost|price|spent|spend)\b/i.test(normalized)) {
    return { intent: 'usage' };
  }

  if (/\b(logs?|history|recent activity|last updates?)\b/i.test(lower)) {
    return { intent: 'logs' };
  }

  if (/\b(help|commands?|what can you do|how do i use you)\b/i.test(lower)) {
    return { intent: 'help' };
  }

  if (/\b(stats?|linked users?|users count)\b/i.test(lower)) {
    return { intent: 'stats' };
  }

  if (/\b(who am i|which account|linked account|my account)\b/i.test(lower)) {
    return { intent: 'whoami' };
  }

  return null;
}

async function classifyTelegramIntent(params: {
  userId: string;
  userEmail?: string | null;
  message: string;
}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.TELEGRAM_AGENT_MODEL?.trim() || 'gemini-3.1-flash-lite-preview';

  const status = getAgentStatus(params.userId);
  const logs = getRecentLogs(params.userId, 10)
    .map((log) => `[${log.timestamp.toISOString()}] ${log.isError ? 'ERROR: ' : ''}${log.message}`)
    .join('\n');

  const prompt = `You are classifying a Telegram bot message for iApply, a LinkedIn job-application agent.

Available intents:
- apply: user wants you to start applying/searching for jobs
- screenshot: user wants a live screenshot/photo of the browser
- stop: user wants the running agent stopped
- status: user wants current status/progress
- usage: user wants token/cost usage
- logs: user wants recent logs
- help: user wants command help
- stats: user wants bot user-count stats
- whoami: user wants linked account info
- chat: anything else

Current agent status: ${status}
Recent logs:
${logs || 'No recent logs.'}

Return strict JSON only with this shape:
{"intent":"apply|screenshot|stop|status|usage|logs|help|stats|whoami|chat","query":"string","userGoal":"string","reply":"string"}

Rules:
- If the user asks to apply, extract a clean job-role-only string in "query" (e.g. "product manager"), stripping filler words and resume preferences.
- If the user asks to apply, put the COMPLETE original instruction verbatim in "userGoal" — do NOT strip resume preferences or any other details from it.
- If intent is not "chat", keep "reply" empty.
- If intent is "chat", give a short helpful plain-text reply in "reply".
- Never wrap JSON in markdown fences.

User message:
${params.message}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 220, temperature: 0.1 },
      }),
    }
  );

  const data = (await response.json()) as any;
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const usage = data?.usageMetadata;

  if (params.userEmail && usage) {
    await recordUsageEvent({
      userId: params.userId,
      userEmail: params.userEmail,
      taskId: null,
      source: 'telegram',
      channel: 'telegram_bot',
      provider: 'gemini',
      model,
      inputTokens: Number(usage.promptTokenCount || 0),
      outputTokens: Number(usage.candidatesTokenCount || 0),
      totalTokens: Number(usage.totalTokenCount || 0),
      metadata: {
        kind: 'telegram_intent_parser',
        prompt_preview: params.message.slice(0, 120),
      },
    });
  }

  if (!raw) return null;

  try {
    const parsed = JSON.parse(stripCodeFence(raw)) as TelegramIntent;
    if (!parsed?.intent) return null;
    if (parsed.intent === 'apply') {
      parsed.query = normalizeApplyQuery(parsed.query || '');
      parsed.userGoal = String(parsed.userGoal || params.message).trim();
    }
    return parsed;
  } catch (error) {
    console.error('Failed to parse Telegram intent JSON:', error, raw);
    return null;
  }
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

  function sendHelpMessage(chatId: number) {
    bot!.sendMessage(
      chatId,
      `🤖 *iApply Bot Commands:*\n\n` +
        `▸ /apply <query> — Start job search & auto-apply\n` +
        `▸ /stop — Stop the running agent\n` +
        `▸ /screenshot — Capture Chrome browser window\n` +
        `▸ /status — Check if agent is running\n` +
        `▸ /whoami — Check account linking status\n` +
        `▸ /stats — Show linked user count\n` +
        `▸ /usage — Show last 10 task usage rows\n` +
        `▸ /logs — View last 10 log entries\n` +
        `▸ /help — Show this help message`,
      { parse_mode: 'Markdown' }
    ).catch(console.error);
  }

  async function sendWhoAmIMessage(chatId: number) {
    const user = await getUserByTelegramId(chatId);

    if (user) {
      bot!.sendMessage(
        chatId,
        `✅ *Linked Successfully*\n\n` +
          `• Chat ID: \`${chatId}\`\n` +
          `• Account: \`${user.email || 'unknown'}\``,
        { parse_mode: 'Markdown' }
      ).catch(console.error);
      return;
    }

    bot!.sendMessage(
      chatId,
      `❌ *Not Linked Yet*\n\n` +
        `• Chat ID: \`${chatId}\`\n\n` +
        `Please complete sign-in using the button below.`,
      {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: 'Sign In', url: getTelegramLoginUrl(chatId) }]],
        },
      }
    ).catch(console.error);
  }

  function sendStatusMessage(chatId: number, userId: string) {
    const status = getAgentStatus(userId);
    const emoji = status === 'running' ? '🟢' : status === 'error' ? '🔴' : '⚪';
    bot!.sendMessage(chatId, `${emoji} Agent Status: *${status.toUpperCase()}*`, {
      parse_mode: 'Markdown',
    }).catch(console.error);
  }

  async function sendStatsMessage(chatId: number) {
    try {
      const linkedUsers = await countLinkedTelegramUsers();
      bot!.sendMessage(chatId, `📊 *Bot Stats*\n\n👥 Linked users: *${linkedUsers}*`, {
        parse_mode: 'Markdown',
      }).catch(console.error);
    } catch (error) {
      console.error('Failed to fetch bot stats:', error);
      bot!.sendMessage(chatId, '⚠️ Could not load bot stats right now.').catch(console.error);
    }
  }

  function sendLogsMessage(chatId: number, userId: string) {
    const logs = getRecentLogs(userId, 10);
    if (logs.length === 0) {
      bot!.sendMessage(chatId, '📭 No logs yet.').catch(console.error);
      return;
    }

    const logText = logs
      .map((log) => {
        const time = log.timestamp.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        return `\`${time}\` ${log.isError ? '❌' : '▸'} ${log.message}`;
      })
      .join('\n');

    bot!.sendMessage(chatId, `📋 *Recent Logs:*\n\n${logText}`, {
      parse_mode: 'Markdown',
    }).catch(console.error);
  }

  async function sendUsageMessage(chatId: number, userId: string) {
    try {
      const { data, error } = await supabase
        .from('task_runs')
        .select('command_text, source, model, prompt_tokens, completion_tokens, total_tokens, total_cost_usd, started_at')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('Failed to fetch Telegram usage rows:', error);
        bot!.sendMessage(chatId, '⚠️ Could not load usage right now.').catch(console.error);
        return;
      }

      if (!data || data.length === 0) {
        bot!.sendMessage(chatId, '📭 No usage rows yet. Start a task first.').catch(console.error);
        return;
      }

      const lines = data.map((row: any, index: number) => {
        const time = new Date(row.started_at).toLocaleString('en-IN', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
        const command = String(row.command_text || '').replace(/\s+/g, ' ').slice(0, 26);
        const model = row.model || 'unknown';
        const tokens = Number(row.total_tokens || 0).toLocaleString('en-US');
        const cost = Number(row.total_cost_usd || 0).toFixed(4);
        return `${index + 1}. \`${time}\` | ${row.source} | ${command}\n   \`${model}\` | in ${row.prompt_tokens || 0} | out ${row.completion_tokens || 0} | total ${tokens} | $${cost}`;
      });

      bot!.sendMessage(chatId, `📊 *Last 10 Usage Rows*\n\n${lines.join('\n\n')}`, {
        parse_mode: 'Markdown',
      }).catch(console.error);
    } catch (error) {
      console.error('Unexpected Telegram usage error:', error);
      bot!.sendMessage(chatId, '⚠️ Could not load usage right now.').catch(console.error);
    }
  }

  function requestScreenshot(chatId: number, userId: string) {
    pushCommand({ userId, type: 'request_screenshot', payload: {} });
    bot!.sendMessage(chatId, '📸 Requesting live screenshot...').catch(console.error);
  }

  async function stopAgent(chatId: number, userId: string) {
    pushCommand({ userId, type: 'stop_agent', payload: {} });
    await stopOpenTasksForUser(userId);
    bot!.sendMessage(
      chatId,
      '⏹ *Agent Stop command sent.*\nThe extension will stop after the current step.',
      { parse_mode: 'Markdown' }
    ).catch(console.error);
  }

  async function startApply(
    chatId: number,
    user: NonNullable<Awaited<ReturnType<typeof getLinkedUser>>>,
    query: string,
    originalText: string,
    userGoal?: string
  ) {
    const cleanedQuery = normalizeApplyQuery(query);
    if (!cleanedQuery) {
      bot!.sendMessage(
        chatId,
        '❌ Please tell me which role to apply for.\nExample: `apply frontend developer`',
        { parse_mode: 'Markdown' }
      ).catch(console.error);
      return;
    }

    const taskRun = user.email
      ? await createTaskRun({
          userId: user.id,
          userEmail: user.email,
          source: 'telegram',
          channel: 'telegram_bot',
          commandText: originalText || `/apply ${cleanedQuery}`,
          metadata: {
            telegram_chat_id: chatId,
            original_text: originalText,
          },
        })
      : null;

    const cmd = pushCommand({
      userId: user.id,
      type: 'start_agent',
      payload: {
        searchQuery: cleanedQuery,
        userGoal: (userGoal || originalText || cleanedQuery).trim(),
        provider: 'gemini',
        model: process.env.TELEGRAM_AGENT_MODEL?.trim() || 'gemini-3.1-flash-lite-preview',
        apiKey: process.env.GEMINI_API_KEY || '',
        taskId: taskRun?.id || undefined,
      },
    });

    const resumeNote = /\b(resume|cv)\b/i.test(originalText)
      ? `\n📄 I will use the uploaded resume that best matches this role.`
      : '';

    bot!.sendMessage(
      chatId,
      `✅ *Agent Started!*\n\n` +
        `🔍 Searching: _${cleanedQuery}_\n` +
        `📋 Command ID: \`${cmd.id}\`\n` +
        `${resumeNote}\n\n` +
        `I'll send you live updates as the agent works.\n` +
        `Use /stop to cancel.`,
      { parse_mode: 'Markdown' }
    ).catch(console.error);
  }

  async function executeIntent(
    msg: TelegramBot.Message,
    user: NonNullable<Awaited<ReturnType<typeof getLinkedUser>>>,
    intent: TelegramIntent
  ) {
    switch (intent.intent) {
      case 'apply':
        await startApply(msg.chat.id, user, intent.query || '', msg.text || '', intent.userGoal);
        return true;
      case 'screenshot':
        requestScreenshot(msg.chat.id, user.id);
        return true;
      case 'stop':
        await stopAgent(msg.chat.id, user.id);
        return true;
      case 'status':
        sendStatusMessage(msg.chat.id, user.id);
        return true;
      case 'usage':
        await sendUsageMessage(msg.chat.id, user.id);
        return true;
      case 'logs':
        sendLogsMessage(msg.chat.id, user.id);
        return true;
      case 'help':
        sendHelpMessage(msg.chat.id);
        return true;
      case 'stats':
        await sendStatsMessage(msg.chat.id);
        return true;
      case 'whoami':
        await sendWhoAmIMessage(msg.chat.id);
        return true;
      case 'chat':
        if (intent.reply) {
          bot!.sendMessage(msg.chat.id, intent.reply).catch(console.error);
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  // /apply command — starts the agent
  bot.onText(/\/apply(?:\s+(.+))?/, async (msg, match) => {
    const user = await getLinkedUser(msg.chat.id);
    if (!user) {
      sendSignInPrompt(msg.chat.id);
      return;
    }

    await startApply(msg.chat.id, user, match?.[1] || '', msg.text || '', msg.text || '');
  });

  bot.onText(/\/stop/, async (msg) => {
    const user = await getLinkedUser(msg.chat.id);
    if (!user) {
      sendSignInPrompt(msg.chat.id);
      return;
    }

    await stopAgent(msg.chat.id, user.id);
  });

  bot.onText(/\/status/, async (msg) => {
    const user = await getLinkedUser(msg.chat.id);
    if (!user) {
      sendSignInPrompt(msg.chat.id, '🔒 Please link your account first.');
      return;
    }

    sendStatusMessage(msg.chat.id, user.id);
  });

  bot.onText(/\/whoami/, async (msg) => {
    await sendWhoAmIMessage(msg.chat.id);
  });

  bot.onText(/\/stats/, async (msg) => {
    const user = await getLinkedUser(msg.chat.id);
    if (!user) {
      sendSignInPrompt(msg.chat.id);
      return;
    }

    await sendStatsMessage(msg.chat.id);
  });

  bot.onText(/\/logs/, async (msg) => {
    const user = await getLinkedUser(msg.chat.id);
    if (!user) {
      sendSignInPrompt(msg.chat.id, '🔒 Please link your account first.');
      return;
    }

    sendLogsMessage(msg.chat.id, user.id);
  });

  bot.onText(/\/screenshot/, async (msg) => {
    const user = await getLinkedUser(msg.chat.id);
    if (!user) {
      sendSignInPrompt(msg.chat.id, '🔒 Please link your account first.');
      return;
    }

    requestScreenshot(msg.chat.id, user.id);
  });

  bot.onText(/\/help/, (msg) => {
    sendHelpMessage(msg.chat.id);
  });

  bot.onText(/\/usage/, async (msg) => {
    const user = await getLinkedUser(msg.chat.id);
    if (!user) {
      sendSignInPrompt(msg.chat.id, '🔒 Please link your account first.');
      return;
    }

    await sendUsageMessage(msg.chat.id, user.id);
  });

  // Conversational Fallback
  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const user = await getLinkedUser(msg.chat.id);
    if (!user) {
      sendSignInPrompt(msg.chat.id);
      return;
    }

    const directIntent = detectDirectIntent(msg.text);
    if (directIntent) {
      await executeIntent(msg, user, directIntent);
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      bot!.sendMessage(
        msg.chat.id,
        'I can start applying, send a screenshot, show status, usage, logs, and help. Try `apply frontend developer`.',
        { parse_mode: 'Markdown' }
      ).catch(console.error);
      return;
    }

    try {
      const aiIntent = await classifyTelegramIntent({
        userId: user.id,
        userEmail: user.email,
        message: msg.text,
      });

      if (aiIntent) {
        const handled = await executeIntent(msg, user, aiIntent);
        if (handled) {
          return;
        }
      }

      bot!.sendMessage(
        msg.chat.id,
        'I can help with applying to roles, screenshots, status, usage, logs, and account info. Try `apply product manager` or `send me screenshot`.',
        { parse_mode: 'Markdown' }
      ).catch(console.error);
    } catch (error) {
      console.error('Gemini fallback error:', error);
      bot!.sendMessage(
        msg.chat.id,
        '⚠️ I could not process that fully, but I can still help. Try `apply frontend developer`, `status`, or `send me screenshot`.',
        { parse_mode: 'Markdown' }
      ).catch(console.error);
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
