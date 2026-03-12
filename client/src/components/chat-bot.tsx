'use client';

import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '@/stores/chat-store';
import { useDashboardStore } from '@/stores/dashboard-store';
import { automationApi, applicationsApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Send, Bot, User, Loader2, Zap } from 'lucide-react';
import type { ChatMessage, Application } from '@/lib/types';

function parseCommand(text: string): { action: string; count?: number } | null {
  const lower = text.toLowerCase().trim();

  // Apply / start commands
  const applyMatch = lower.match(/(?:apply|start)\s*(?:to\s*)?(\d+)?\s*(?:jobs?)?/);
  if (applyMatch) {
    return { action: 'start', count: applyMatch[1] ? parseInt(applyMatch[1]) : 10 };
  }

  // Pause
  if (/\bpause\b/.test(lower)) {
    return { action: 'pause' };
  }

  // Stop
  if (/\bstop\b/.test(lower)) {
    return { action: 'stop' };
  }

  // Status
  if (/\b(status|how|progress|running)\b/.test(lower)) {
    return { action: 'status' };
  }

  // Show applications
  if (/\b(show|list|my|recent|applications?|applied|jobs?)\b/.test(lower)) {
    return { action: 'applications' };
  }

  // Help
  if (/\b(help|commands?|what can)\b/.test(lower)) {
    return { action: 'help' };
  }

  return null;
}

function formatTime(date: Date) {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatApplicationsResponse(apps: Application[]): string {
  if (apps.length === 0) {
    return "You don't have any applications yet. Say \"apply 5 jobs\" to get started!";
  }

  const lines = apps.slice(0, 5).map((app, i) => {
    const status = app.status === 'applied' ? '✅' : app.status === 'failed' ? '❌' : app.status === 'pending' ? '⏳' : '🔄';
    const company = app.job?.company || 'Unknown';
    const title = app.job?.title || 'Unknown Position';
    return `${status} ${company} — ${title} (${app.status})`;
  });

  let result = `Here are your recent applications:\n\n${lines.join('\n')}`;
  if (apps.length > 5) {
    result += `\n\n...and ${apps.length - 5} more. Check the Applications page for the full list.`;
  }
  return result;
}

export function ChatBot() {
  const { messages, addMessage, updateMessage } = useChatStore();
  const { automationStatus, setAutomationStatus, setApplications, resume } = useDashboardStore();
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleCommand = async (command: { action: string; count?: number }) => {
    setIsProcessing(true);

    try {
      switch (command.action) {
        case 'start': {
          if (!resume) {
            addMessage({
              role: 'bot',
              content: '⚠️ Please upload your resume first before starting automation. Go to the Resume page to upload it.',
            });
            break;
          }

          if (automationStatus.isRunning) {
            addMessage({
              role: 'bot',
              content: '⚠️ Automation is already running! Say "stop" first if you want to restart.',
            });
            break;
          }

          const count = command.count || 10;
          await automationApi.start(count);
          setAutomationStatus({ ...automationStatus, isRunning: true, currentAction: 'scrape_jobs' });
          addMessage({
            role: 'bot',
            content: `🚀 Started automation! I'll apply to ${count} jobs for you. The browser extension will handle the applications.\n\nSay "status" to check progress or "stop" to cancel.`,
          });
          break;
        }

        case 'pause': {
          if (!automationStatus.isRunning) {
            addMessage({
              role: 'bot',
              content: "There's no automation running right now. Say \"apply 5 jobs\" to start one!",
            });
            break;
          }

          await automationApi.pause();
          setAutomationStatus({ ...automationStatus, isRunning: false });
          addMessage({
            role: 'bot',
            content: '⏸️ Automation paused. Say "start" to resume.',
          });
          break;
        }

        case 'stop': {
          if (!automationStatus.isRunning) {
            addMessage({
              role: 'bot',
              content: "Nothing is running right now. Say \"apply 10 jobs\" to start!",
            });
            break;
          }

          await automationApi.stop();
          setAutomationStatus({ isRunning: false, jobsScraped: 0, jobsApplied: 0, jobsFailed: 0 });
          addMessage({
            role: 'bot',
            content: '🛑 Automation stopped and reset.',
          });
          break;
        }

        case 'status': {
          try {
            const res = await automationApi.status();
            const s = res.data;
            if (s.isRunning) {
              addMessage({
                role: 'bot',
                content: `📊 Automation is **running**\n• Jobs scraped: ${s.jobsScraped}\n• Jobs applied: ${s.jobsApplied}\n• Jobs failed: ${s.jobsFailed}\n• Current action: ${s.currentAction?.replace('_', ' ') || 'processing'}`,
              });
            } else {
              addMessage({
                role: 'bot',
                content: `📊 Automation is **idle**\n• Total applied: ${s.jobsApplied}\n• Total failed: ${s.jobsFailed}\n\nSay "apply 10 jobs" to start!`,
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

        case 'help': {
          addMessage({
            role: 'bot',
            content:
              'Here\'s what I can do:\n\n• **"Apply to 5 jobs"** — Start automation for N jobs\n• **"Pause"** — Pause current automation\n• **"Stop"** — Stop and reset automation\n• **"Status"** — Check automation progress\n• **"Show applications"** — See recent applications\n• **"Help"** — Show this message',
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

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isProcessing) return;

    setInput('');
    addMessage({ role: 'user', content: text });

    const command = parseCommand(text);
    if (command) {
      await handleCommand(command);
    } else {
      addMessage({
        role: 'bot',
        content: "I'm not sure what you mean. Try saying:\n• \"Apply to 5 jobs\"\n• \"Status\"\n• \"Show applications\"\n• \"Pause\" or \"Stop\"\n• \"Help\"",
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

  return (
    <div className="bg-white rounded-xl border flex flex-col" style={{ height: '500px' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b">
        <div className={cn(
          'w-10 h-10 rounded-full flex items-center justify-center',
          automationStatus.isRunning ? 'bg-green-100' : 'bg-primary-100'
        )}>
          <Zap className={cn(
            'h-5 w-5',
            automationStatus.isRunning ? 'text-green-600' : 'text-primary-600'
          )} />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-semibold">Job Assistant</h2>
          <p className="text-sm text-gray-500">
            {automationStatus.isRunning ? (
              <span className="text-green-600 flex items-center gap-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                </span>
                Running — {automationStatus.jobsApplied} applied
              </span>
            ) : (
              'Ask me to apply to jobs'
            )}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isProcessing && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
              <Bot className="h-4 w-4 text-primary-600" />
            </div>
            <div className="bg-gray-100 rounded-2xl rounded-tl-md px-4 py-3">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t px-6 py-4">
        <div className="flex items-center gap-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Try "Apply to 5 jobs" or "Show status"...'
            className="flex-1 border rounded-full px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            disabled={isProcessing}
          />
          <button
            onClick={handleSend}
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
      <div className={cn(
        'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
        isUser ? 'bg-primary-600' : 'bg-primary-100'
      )}>
        {isUser ? (
          <User className="h-4 w-4 text-white" />
        ) : (
          <Bot className="h-4 w-4 text-primary-600" />
        )}
      </div>
      <div className={cn(
        'max-w-[75%] rounded-2xl px-4 py-3',
        isUser
          ? 'bg-primary-600 text-white rounded-tr-md'
          : 'bg-gray-100 text-gray-800 rounded-tl-md'
      )}>
        <p className="text-sm whitespace-pre-line">{message.content}</p>
        <p className={cn(
          'text-xs mt-1',
          isUser ? 'text-primary-200' : 'text-gray-400'
        )}>
          {formatTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}
