'use client';

import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '@/stores/chat-store';
import { useDashboardStore } from '@/stores/dashboard-store';
import { automationApi, applicationsApi, profileApi, preferencesApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Send,
  Bot,
  User,
  Loader2,
  Zap,
  Briefcase,
  FileText,
  Settings,
  HelpCircle,
  BarChart3,
  Play,
  Square,
  Pause,
  Sparkles,
} from 'lucide-react';
import type { ChatMessage, Application } from '@/lib/types';

type CommandCategory = 'extension' | 'local' | 'info';

interface ParsedCommand {
  action: string;
  count?: number;
  category: CommandCategory;
}

function parseCommand(text: string): ParsedCommand | null {
  const lower = text.toLowerCase().trim();

  // --- Extension-routed commands (apply jobs) ---
  const applyMatch = lower.match(
    /(?:apply|start|begin|run)\s*(?:to\s*|for\s*)?(\d+)?\s*(?:jobs?)?(?:\s*(?:based on|using|from|with)\s*(?:my\s*)?(?:profile|resume|preferences?))?/
  );
  if (applyMatch) {
    return { action: 'start', count: applyMatch[1] ? parseInt(applyMatch[1]) : 10, category: 'extension' };
  }

  // Pause automation → extension
  if (/\bpause\b/.test(lower)) {
    return { action: 'pause', category: 'extension' };
  }

  // Stop / cancel automation → extension
  if (/\b(stop|cancel)\b/.test(lower)) {
    return { action: 'stop', category: 'extension' };
  }

  // Resume automation → extension
  if (/\bresume\b/.test(lower) && !/\bresume\s+(page|upload|file|pdf|doc)/i.test(lower)) {
    return { action: 'start', count: 10, category: 'extension' };
  }

  // --- Local queries ---
  // Status
  if (/\b(status|how('?s| is)?|progress|running|update)\b/.test(lower)) {
    return { action: 'status', category: 'info' };
  }

  // Show applications
  if (/\b(show|list|my|recent|applications?|applied|history)\b/.test(lower)) {
    return { action: 'applications', category: 'info' };
  }

  // Profile info
  if (/\b(profile|about me|my (info|details|name|skills))\b/.test(lower)) {
    return { action: 'profile', category: 'local' };
  }

  // Resume info
  if (/\b(resume|cv|document|uploaded)\b/.test(lower)) {
    return { action: 'resume', category: 'local' };
  }

  // Preferences info
  if (/\b(preferences?|settings?|job\s*(type|role|location)|salary|remote)\b/.test(lower)) {
    return { action: 'preferences', category: 'local' };
  }

  // Stats / summary
  if (/\b(stats|statistics|summary|overview|numbers|count)\b/.test(lower)) {
    return { action: 'stats', category: 'info' };
  }

  // Help
  if (/\b(help|commands?|what can|how to|guide)\b/.test(lower)) {
    return { action: 'help', category: 'info' };
  }

  return null;
}

function formatTime(date: Date) {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatApplicationsResponse(apps: Application[]): string {
  if (apps.length === 0) {
    return "You don't have any applications yet. Try saying **\"apply 5 jobs\"** to get started!";
  }

  const lines = apps.slice(0, 5).map((app) => {
    const status =
      app.status === 'applied' ? '✅' :
      app.status === 'failed' ? '❌' :
      app.status === 'pending' ? '⏳' : '🔄';
    const company = app.job?.company || 'Unknown';
    const title = app.job?.title || 'Unknown Position';
    return `${status} **${company}** — ${title} (${app.status})`;
  });

  let result = `Here are your recent applications:\n\n${lines.join('\n')}`;
  if (apps.length > 5) {
    result += `\n\n...and ${apps.length - 5} more. Check the Applications page for the full list.`;
  }
  return result;
}

const quickActions = [
  { label: 'Apply 5 jobs', icon: Play, command: 'apply 5 jobs based on my profile' },
  { label: 'Status', icon: BarChart3, command: 'status' },
  { label: 'My applications', icon: Briefcase, command: 'show my applications' },
  { label: 'My profile', icon: User, command: 'show my profile' },
  { label: 'Preferences', icon: Settings, command: 'show preferences' },
  { label: 'Help', icon: HelpCircle, command: 'help' },
];

export function ChatBot() {
  const { messages, addMessage } = useChatStore();
  const { automationStatus, setAutomationStatus, setApplications, resume, profile, preferences } =
    useDashboardStore();
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleCommand = async (command: ParsedCommand) => {
    setIsProcessing(true);

    try {
      switch (command.action) {
        // ---- Extension-routed: apply jobs ----
        case 'start': {
          if (!resume) {
            addMessage({
              role: 'bot',
              content:
                '⚠️ Please upload your resume first before I can start applying.\n\nGo to the **Resume** page from the sidebar to upload it.',
            });
            break;
          }

          if (automationStatus.isRunning) {
            addMessage({
              role: 'bot',
              content:
                '⚠️ Automation is already running! Say **"stop"** first if you want to restart.',
            });
            break;
          }

          const count = command.count || 10;
          await automationApi.start(count);
          setAutomationStatus({ ...automationStatus, isRunning: true, currentAction: 'scrape_jobs' });
          addMessage({
            role: 'bot',
            content: `🚀 **Started!** I'm applying to **${count} jobs** based on your profile.\n\nThe browser extension will handle the applications on LinkedIn.\n\n💡 You can say:\n• **"status"** — check progress\n• **"pause"** — pause automation\n• **"stop"** — cancel everything`,
          });
          break;
        }

        case 'pause': {
          if (!automationStatus.isRunning) {
            addMessage({
              role: 'bot',
              content: "Nothing is running right now. Say **\"apply 5 jobs\"** to start!",
            });
            break;
          }

          await automationApi.pause();
          setAutomationStatus({ ...automationStatus, isRunning: false });
          addMessage({
            role: 'bot',
            content: '⏸️ Automation **paused**. Say **"resume"** or **"start"** to continue.',
          });
          break;
        }

        case 'stop': {
          if (!automationStatus.isRunning) {
            addMessage({
              role: 'bot',
              content: "Nothing is running right now. Say **\"apply 10 jobs\"** to start!",
            });
            break;
          }

          await automationApi.stop();
          setAutomationStatus({ isRunning: false, jobsScraped: 0, jobsApplied: 0, jobsFailed: 0 });
          addMessage({
            role: 'bot',
            content: '🛑 Automation **stopped** and reset. Ready for your next command!',
          });
          break;
        }

        // ---- Info queries ----
        case 'status': {
          try {
            const res = await automationApi.status();
            const s = res.data;
            if (s.isRunning) {
              addMessage({
                role: 'bot',
                content: `📊 **Automation is running**\n\n• 🔍 Jobs scraped: **${s.jobsScraped}**\n• ✅ Jobs applied: **${s.jobsApplied}**\n• ❌ Jobs failed: **${s.jobsFailed}**\n• ⚙️ Current: ${s.currentAction?.replace('_', ' ') || 'processing'}\n\nSay **"stop"** to cancel or **"pause"** to pause.`,
              });
            } else {
              addMessage({
                role: 'bot',
                content: `📊 **Automation is idle**\n\n• ✅ Total applied: **${s.jobsApplied}**\n• ❌ Total failed: **${s.jobsFailed}**\n\nSay **"apply 10 jobs"** to start!`,
              });
            }
            setAutomationStatus(s);
          } catch {
            addMessage({ role: 'bot', content: '❌ Failed to fetch status. Please try again.' });
          }
          break;
        }

        case 'applications': {
          try {
            const res = await applicationsApi.list(1, 10);
            const apps = res.data?.items || [];
            setApplications(apps);
            addMessage({ role: 'bot', content: formatApplicationsResponse(apps) });
          } catch {
            addMessage({ role: 'bot', content: '❌ Failed to fetch applications. Please try again.' });
          }
          break;
        }

        case 'stats': {
          const queue = automationStatus.jobsScraped - automationStatus.jobsApplied - automationStatus.jobsFailed;
          addMessage({
            role: 'bot',
            content: `📈 **Your Stats**\n\n• ✅ Applied: **${automationStatus.jobsApplied}**\n• 🔍 Scraped: **${automationStatus.jobsScraped}**\n• ❌ Failed: **${automationStatus.jobsFailed}**\n• ⏳ In queue: **${queue}**\n• Status: ${automationStatus.isRunning ? '🟢 Running' : '⚪ Idle'}`,
          });
          break;
        }

        // ---- Local queries ----
        case 'profile': {
          if (!profile) {
            addMessage({
              role: 'bot',
              content:
                "You haven't set up your profile yet.\n\nGo to the **Profile** page from the sidebar to fill in your details.",
            });
            break;
          }
          const skills = profile.skills?.length ? profile.skills.join(', ') : 'None set';
          const roles = profile.preferredRoles?.length ? profile.preferredRoles.join(', ') : 'None set';
          addMessage({
            role: 'bot',
            content: `👤 **Your Profile**\n\n• **Name:** ${profile.fullName}\n• **Location:** ${profile.location || 'Not set'}\n• **Experience:** ${profile.experienceYears} years\n• **Skills:** ${skills}\n• **Preferred Roles:** ${roles}\n• **Phone:** ${profile.phone || 'Not set'}`,
          });
          break;
        }

        case 'resume': {
          if (!resume) {
            addMessage({
              role: 'bot',
              content:
                "No resume uploaded yet.\n\nGo to the **Resume** page from the sidebar to upload your resume.",
            });
            break;
          }
          addMessage({
            role: 'bot',
            content: `📄 **Your Resume**\n\n• **File:** ${resume.fileName}\n• **Uploaded:** ${new Date(resume.uploadedAt).toLocaleDateString()}\n• **Parsed:** ${resume.parsedData ? 'Yes ✅' : 'No'}`,
          });
          break;
        }

        case 'preferences': {
          try {
            const res = await preferencesApi.get();
            const prefs = res.data;
            if (!prefs) {
              addMessage({
                role: 'bot',
                content:
                  "No preferences set yet.\n\nGo to the **Preferences** page from the sidebar to configure them.",
              });
              break;
            }
            const roles = prefs.roles?.length ? prefs.roles.join(', ') : 'Any';
            const locations = prefs.locations?.length ? prefs.locations.join(', ') : 'Any';
            const jobTypes = prefs.jobTypes?.length ? prefs.jobTypes.join(', ') : 'Any';
            addMessage({
              role: 'bot',
              content: `⚙️ **Your Preferences**\n\n• **Roles:** ${roles}\n• **Locations:** ${locations}\n• **Remote only:** ${prefs.remoteOnly ? 'Yes' : 'No'}\n• **Experience:** ${prefs.experienceLevel}\n• **Job types:** ${jobTypes}\n• **Salary:** ${prefs.minSalary ? `$${prefs.minSalary.toLocaleString()}` : 'Not set'} – ${prefs.maxSalary ? `$${prefs.maxSalary.toLocaleString()}` : 'Not set'}`,
            });
          } catch {
            addMessage({
              role: 'bot',
              content:
                "No preferences found. Go to the **Preferences** page to set them up.",
            });
          }
          break;
        }

        case 'help': {
          addMessage({
            role: 'bot',
            content:
              '🤖 **Here\'s what I can do:**\n\n**Job Automation** _(sent to extension)_\n• **"Apply 5 jobs"** — Start applying to N jobs\n• **"Apply 10 jobs based on my profile"** — Same, explicit\n• **"Pause"** — Pause current automation\n• **"Stop"** — Stop and reset\n• **"Resume"** — Resume paused automation\n\n**Info & Status**\n• **"Status"** — Check automation progress\n• **"Show applications"** — See recent applications\n• **"Stats"** — View your numbers\n\n**Profile & Settings**\n• **"Show my profile"** — View profile info\n• **"Show resume"** — View resume details\n• **"Preferences"** — View job preferences',
          });
          break;
        }
      }
    } catch (error: any) {
      addMessage({
        role: 'bot',
        content: `❌ Error: ${error.response?.data?.error || error.message || 'Something went wrong'}`,
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSend = async (text?: string) => {
    const messageText = (text || input).trim();
    if (!messageText || isProcessing) return;

    if (!text) setInput('');
    addMessage({ role: 'user', content: messageText });

    const command = parseCommand(messageText);
    if (command) {
      await handleCommand(command);
    } else {
      addMessage({
        role: 'bot',
        content:
          "I'm not sure what you mean. Here are some things you can try:\n\n• **\"Apply 5 jobs based on my profile\"**\n• **\"Show status\"**\n• **\"Show my applications\"**\n• **\"Show my profile\"**\n• **\"Preferences\"**\n• **\"Help\"** for full command list",
      });
    }

    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const showQuickActions = messages.length <= 1;

  return (
    <div className="flex min-h-[28rem] max-h-[calc(100vh-8rem)] flex-col rounded-xl border bg-white h-[70vh] md:h-[600px] md:max-h-[calc(100vh-200px)]">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b bg-gradient-to-r from-primary-50 to-white rounded-t-xl">
        <div
          className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center',
            automationStatus.isRunning ? 'bg-green-100' : 'bg-primary-100'
          )}
        >
          <Sparkles
            className={cn(
              'h-5 w-5',
              automationStatus.isRunning ? 'text-green-600' : 'text-primary-600'
            )}
          />
        </div>
        <div className="flex-1">
          <h2 className="text-base sm:text-lg font-semibold">Job Assistant</h2>
          <p className="text-xs sm:text-sm text-gray-500">
            {automationStatus.isRunning ? (
              <span className="text-green-600 flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                Running — {automationStatus.jobsApplied} applied, {automationStatus.jobsFailed} failed
              </span>
            ) : (
              'Tell me what to do — e.g. "apply 5 jobs"'
            )}
          </p>
        </div>
        {automationStatus.isRunning && (
          <button
            onClick={() => handleSend('stop')}
            className="flex items-center gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-100 sm:px-3"
          >
            <Square className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Stop</span>
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Quick Actions — shown only at the start */}
        {showQuickActions && !isProcessing && (
          <div className="pt-2">
            <p className="text-xs text-gray-400 mb-3 font-medium uppercase tracking-wide">Quick actions</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {quickActions.map((qa) => (
                <button
                  key={qa.label}
                  onClick={() => handleSend(qa.command)}
                  className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 hover:bg-primary-50 hover:text-primary-700 border border-gray-200 hover:border-primary-200 rounded-lg px-3 py-2.5 transition text-left"
                >
                  <qa.icon className="h-4 w-4 flex-shrink-0" />
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {isProcessing && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
              <Bot className="h-4 w-4 text-primary-600" />
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-tl-md px-4 py-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                <span className="text-sm text-gray-500">Processing...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggestion chips when automation is running */}
      {automationStatus.isRunning && (
        <div className="px-4 sm:px-6 pb-2 flex gap-2 flex-wrap">
          {[
            { label: '📊 Status', cmd: 'status' },
            { label: '⏸ Pause', cmd: 'pause' },
            { label: '🛑 Stop', cmd: 'stop' },
          ].map((chip) => (
            <button
              key={chip.cmd}
              onClick={() => handleSend(chip.cmd)}
              disabled={isProcessing}
              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-full transition disabled:opacity-50"
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t px-4 sm:px-6 py-3 sm:py-4 bg-gray-50 rounded-b-xl">
        <div className="flex items-center gap-2 sm:gap-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Try "Apply 5 jobs" or "Show status"...'
            className="flex-1 rounded-full border border-gray-200 bg-white px-4 py-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 sm:px-5"
            disabled={isProcessing}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isProcessing}
            className="w-11 h-11 rounded-full bg-primary-600 text-white flex items-center justify-center hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          >
            <Send className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex items-start gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
          isUser ? 'bg-primary-600' : 'bg-primary-100'
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-white" />
        ) : (
          <Bot className="h-4 w-4 text-primary-600" />
        )}
      </div>
      <div
        className={cn(
          'max-w-[88%] rounded-2xl px-4 py-3 sm:max-w-[80%]',
          isUser ? 'bg-primary-600 text-white rounded-tr-md' : 'bg-gray-100 text-gray-800 rounded-tl-md'
        )}
      >
        <div className="text-sm whitespace-pre-line leading-relaxed">
          {renderMarkdown(message.content)}
        </div>
        <p className={cn('text-xs mt-1.5', isUser ? 'text-primary-200' : 'text-gray-400')}>
          {formatTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}

/** Simple markdown: **bold** support */
function renderMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}
