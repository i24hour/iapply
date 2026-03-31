'use client';

import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '@/stores/chat-store';
import { useDashboardStore } from '@/stores/dashboard-store';
import { api, automationApi, applicationsApi, extensionApi, profileApi, preferencesApi } from '@/lib/api';
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

type RecordingFrame = {
  id: string;
  url: string;
  createdAt: string;
};

type CommandCategory = 'extension' | 'local' | 'info';
type ApplyMode = 'easy' | 'apply' | 'easy_jd_resume';

type SessionGeneratedResume = {
  resumeId: string;
  fileName: string;
  jobTitle: string;
  company: string;
  generatedAt: string;
};

interface ParsedCommand {
  action: string;
  count?: number;
  category: CommandCategory;
  applyMode?: ApplyMode;
  searchQuery?: string;
  targetText?: string;
}

function parseGeneratedResumeLog(rawMessage: string): SessionGeneratedResume | null {
  const marker = 'JD_RESUME_READY::';
  if (!String(rawMessage || '').startsWith(marker)) return null;
  const payloadText = String(rawMessage || '').slice(marker.length).trim();
  if (!payloadText) return null;

  try {
    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    const resumeId = String(payload.resumeId || '').trim();
    if (!resumeId) return null;

    return {
      resumeId,
      fileName: String(payload.fileName || 'generated-resume.docx').trim() || 'generated-resume.docx',
      jobTitle: String(payload.jobTitle || 'Role').trim() || 'Role',
      company: String(payload.company || 'Company').trim() || 'Company',
      generatedAt: String(payload.generatedAt || new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

function extractSearchQueryFromApplyText(text: string): string {
  const raw = String(text || '').trim();
  if (!raw) return '';

  // Examples handled:
  // "apply for product manager"
  // "apply to software engineer jobs"
  // "start backend developer"
  const directMatch = raw.match(
    /(?:apply|start|begin|run)\s*(?:to|for)?\s*(.+?)(?:\s+\d+\s*jobs?)?(?:\s+based on.*)?$/i
  );
  if (!directMatch?.[1]) return '';

  const cleaned = directMatch[1]
    .replace(/\b(easy\s*apply|jobs?|based on|using|from|with|my|profile|resume|preferences?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Guard: if user only said "apply 5 jobs", don't treat "5" as query.
  if (!cleaned || /^\d+$/.test(cleaned)) return '';
  return cleaned;
}

function normalizeManualClickTarget(rawTarget: string): string {
  return String(rawTarget || '')
    .replace(/^[`"'“”\s]+|[`"'“”\s]+$/g, '')
    .replace(/\b(?:please|pls|plz|now|abhi|just)\b/gi, ' ')
    .replace(/\b(?:ko\s+)?click\s*(?:karo|kar do|krdo|kr do)?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractManualClickTarget(text: string): string {
  const raw = String(text || '').trim();
  if (!raw) return '';

  const direct = raw.match(/\b(?:click|tap|press)\s+(?:on\s+)?(.+)/i);
  if (direct?.[1]) {
    const normalized = normalizeManualClickTarget(direct[1]);
    if (normalized) return normalized;
  }

  const hindiStyle = raw.match(/^(.+?)\s+(?:ko\s+)?click\s*(?:karo|kar do|krdo|kr do)?$/i);
  if (hindiStyle?.[1]) {
    const normalized = normalizeManualClickTarget(hindiStyle[1]);
    if (normalized) return normalized;
  }

  return '';
}

function parseCommand(text: string): ParsedCommand | null {
  const lower = text.toLowerCase().trim();

  // --- Extension-routed commands (apply jobs) ---
  const easyApplyMatch = lower.match(
    /(?:easy\s*apply|easyapply)\s*(?:to\s*|for\s*)?(\d+)?\s*(?:jobs?)?/
  );
  if (easyApplyMatch) {
    return {
      action: 'start',
      applyMode: 'easy',
      count: easyApplyMatch[1] ? parseInt(easyApplyMatch[1]) : 10,
      category: 'extension',
    };
  }

  const applyMatch = lower.match(
    /(?:apply|start|begin|run)\s*(?:to\s*|for\s*)?(\d+)?\s*(?:jobs?)?(?:\s*(?:based on|using|from|with)\s*(?:my\s*)?(?:profile|resume|preferences?))?/
  );
  if (applyMatch) {
    const extractedSearchQuery = extractSearchQueryFromApplyText(text);
    return {
      action: 'start',
      applyMode: 'apply',
      count: applyMatch[1] ? parseInt(applyMatch[1]) : 10,
      category: 'extension',
      searchQuery: extractedSearchQuery || undefined,
    };
  }

  if (/\b(start|begin|enable|turn on)\s+(recording|screen\s*record)/.test(lower)) {
    return { action: 'start_recording', category: 'extension' };
  }

  if (/\b(stop|disable|turn off)\s+(recording|screen\s*record)/.test(lower)) {
    return { action: 'stop_recording', category: 'extension' };
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

  if (/\b(screenshot|snap|capture)\b/.test(lower)) {
    return { action: 'screenshot', category: 'extension' };
  }

  const clickTarget = extractManualClickTarget(text);
  if (clickTarget) {
    return { action: 'manual_click', category: 'extension', targetText: clickTarget };
  }

  if (/\b(logs?|recording|screen\s*record|live\s*feed|stream)\b/.test(lower)) {
    return { action: 'live_feed', category: 'info' };
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

function normalizeMediaUrl(url: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  const base = (api.defaults.baseURL || '').replace(/\/$/, '');
  return `${base}${url.startsWith('/') ? url : `/${url}`}`;
}

const quickActions = [
  { label: 'Easy Apply 5 jobs', icon: Zap, command: 'easy apply 5 jobs' },
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
  const [selectedApplyMode, setSelectedApplyMode] = useState<ApplyMode>('easy');
  const [sessionGeneratedResumes, setSessionGeneratedResumes] = useState<SessionGeneratedResume[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingFrames, setRecordingFrames] = useState<RecordingFrame[]>([]);
  const [isRecordingActive, setIsRecordingActive] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastLogRef = useRef('');
  const lastScreenshotRef = useRef('');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    let isUnmounted = false;

    const pullLiveFeed = async () => {
      try {
        const res = await extensionApi.live(25, 3, 12);
        const payload = res.data || {};
        const logs = Array.isArray(payload.logs) ? payload.logs : [];
        const screenshots = Array.isArray(payload.screenshots) ? payload.screenshots : [];
        const recordings = Array.isArray(payload.recordings) ? payload.recordings : [];
        const recordingActive = Boolean(payload.recordingActive);

        if (!isUnmounted) {
          setIsRecordingActive(recordingActive);
          setRecordingFrames(
            recordings
              .filter((item: any) => item?.url)
              .map((item: any) => ({
                id: item.id,
                url: normalizeMediaUrl(item.url),
                createdAt: item.createdAt,
              }))
          );
        }

        if (!isUnmounted && logs.length) {
          const unseenLogs = logs.filter((log: any) => {
            const key = `${log.timestamp}|${log.message}|${log.isError ? '1' : '0'}`;
            return key > lastLogRef.current;
          });

          if (unseenLogs.length) {
            const latest = unseenLogs.slice(-4);
            latest.forEach((log: any) => {
              const key = `${log.timestamp}|${log.message}|${log.isError ? '1' : '0'}`;
              lastLogRef.current = key;

              const generatedResume = parseGeneratedResumeLog(String(log.message || ''));
              if (generatedResume) {
                setSessionGeneratedResumes((prev) => {
                  if (prev.some((item) => item.resumeId === generatedResume.resumeId)) return prev;
                  return [generatedResume, ...prev].slice(0, 20);
                });
                addMessage({
                  role: 'bot',
                  content: `🧠 **JD Resume Generated**\n\n• **Role:** ${generatedResume.jobTitle}\n• **Company:** ${generatedResume.company}\n• **File:** ${generatedResume.fileName}`,
                });
                return;
              }

              addMessage({
                role: 'bot',
                content: `${log.isError ? '❌' : '🧾'} **Extension Log**: ${log.message}`,
              });
            });
          }
        }

        if (!isUnmounted && screenshots.length) {
          const latestShot = screenshots[0];
          if (latestShot?.url && latestShot.url !== lastScreenshotRef.current) {
            lastScreenshotRef.current = latestShot.url;
            addMessage({
              role: 'bot',
              content: `🎥 **Latest Screen Capture**\n${normalizeMediaUrl(latestShot.url)}`,
            });
          }
        }
      } catch {
        // Silent when extension/backend feed is temporarily unavailable.
      }
    };

    const interval = setInterval(pullLiveFeed, 4000);
    pullLiveFeed();

    return () => {
      isUnmounted = true;
      clearInterval(interval);
    };
  }, [addMessage]);

  const handleCommand = async (command: ParsedCommand, rawCommandText: string) => {
    setIsProcessing(true);

    try {
      switch (command.action) {
        // ---- Extension-routed: apply jobs ----
        case 'start': {
          const applyMode: ApplyMode = command.applyMode || 'apply';

          if (applyMode === 'apply' && !resume) {
            addMessage({
              role: 'bot',
              content:
                '⚠️ Please upload your resume first before I can start applying.\n\nGo to the **Resume** page from the sidebar to upload it.',
            });
            break;
          }

          if (applyMode === 'easy_jd_resume' && !resume) {
            addMessage({
              role: 'bot',
              content:
                'ℹ️ Base resume not found. JD-mode run will continue using profile + job context. Better results ke liye Resume page me ek base resume upload karna recommended hai.',
            });
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
          await automationApi.start(count, {
            source: 'frontend',
            channel: 'dashboard_chat',
            commandText: rawCommandText,
            searchQuery: command.searchQuery,
            applyMode,
            resumeMode: applyMode,
            provider: 'gemini',
          });
          setAutomationStatus({ ...automationStatus, isRunning: true, currentAction: 'scrape_jobs' });

          if (applyMode === 'easy') {
            addMessage({
              role: 'bot',
              content: `⚡ **Easy Apply Started!** Running for **${count} jobs**.\n\nThis mode does **not require uploaded resume** in iApply and relies on your LinkedIn Easy Apply setup.\n\n💡 You can say:\n• **"status"** — check progress\n• **"pause"** — pause automation\n• **"stop"** — cancel everything`,
            });
            break;
          }

          if (applyMode === 'easy_jd_resume') {
            addMessage({
              role: 'bot',
              content: `🧠 **Easy Apply with JD Resume Started!** Running for **${count} jobs**.\n\nFor each Easy Apply job, extension JD context pickup karega, backend tailored resume generate karega, aur wahi resume upload+select karke apply karega.\n\nSession me generated resumes yahin chat me dikhte rahenge.\n\n💡 You can say:\n• **"status"** — check progress\n• **"pause"** — pause automation\n• **"stop"** — cancel everything`,
            });
            break;
          }

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
          await automationApi.stop();
          setAutomationStatus({ isRunning: false, jobsScraped: 0, jobsApplied: 0, jobsFailed: 0 });
          addMessage({
            role: 'bot',
            content: automationStatus.isRunning
              ? '🛑 Automation **stopped** and reset. Ready for your next command!'
              : '🛑 Stop command sent. Agar extension background me run kar raha tha, ab halt ho jayega.',
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

        case 'live_feed': {
          addMessage({
            role: 'bot',
            content:
              '🛰️ Live feed is active in this chat. I will keep posting extension logs and the latest capture automatically while automation runs.',
          });
          break;
        }

        case 'screenshot': {
          try {
            await extensionApi.requestScreenshot();
            addMessage({
              role: 'bot',
              content:
                '📸 Screenshot requested from the extension. I will post the latest capture here as soon as it arrives.',
            });
          } catch {
            addMessage({
              role: 'bot',
              content: '❌ Could not request screenshot right now. Ensure extension is logged in and running.',
            });
          }
          break;
        }

        case 'manual_click': {
          const targetText = String(command.targetText || '').trim();
          if (!targetText) {
            addMessage({
              role: 'bot',
              content: '❌ Tell me what to click, for example: **"click Not now"**.',
            });
            break;
          }
          try {
            await extensionApi.manualClick(targetText);
            addMessage({
              role: 'bot',
              content: `🖱️ Click request queued for **"${targetText}"**. Extension ab LinkedIn tab me ise click karne ki koshish karega.`,
            });
          } catch {
            addMessage({
              role: 'bot',
              content: '❌ Could not send click command right now. Ensure extension is active and authenticated.',
            });
          }
          break;
        }

        case 'start_recording': {
          try {
            await extensionApi.startRecording();
            addMessage({
              role: 'bot',
              content:
                '⏺️ Recording started. I will keep adding fresh frames to the Live Recording Timeline in this chat.',
            });
          } catch {
            addMessage({
              role: 'bot',
              content: '❌ Could not start recording. Ensure extension is active and authenticated.',
            });
          }
          break;
        }

        case 'stop_recording': {
          try {
            await extensionApi.stopRecording();
            addMessage({
              role: 'bot',
              content:
                '⏹️ Recording stopped. Existing timeline frames are still visible in chat history.',
            });
          } catch {
            addMessage({
              role: 'bot',
              content: '❌ Could not stop recording right now. Please try again.',
            });
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
              '🤖 **Here\'s what I can do:**\n\n**Job Automation** _(sent to extension)_\n• **"Easy apply 5 jobs"** — Easy Apply mode (no iApply resume required)\n• **"Apply 5 jobs"** — Apply mode (uses uploaded resume flow)\n• **Mode toggle: "Easy Apply with JD resume"** — per-job tailored resume generation\n• **"Pause"** — Pause current automation\n• **"Stop"** — Stop and reset\n• **"Resume"** — Resume paused automation\n\n**Manual Control**\n• **"click not now"**\n• **"not now ko click krdo"**\n• **"tap continue"**\n\n**Live Monitoring**\n• **"logs"** or **"live feed"** — Confirm live stream mode\n• **"screenshot"** — Request an instant capture from extension\n• **"start recording"** — Force recording ON\n• **"stop recording"** — Force recording OFF\n• Extension logs and latest captures are auto-posted here\n\n**Info & Status**\n• **"Status"** — Check automation progress\n• **"Show applications"** — See recent applications\n• **"Stats"** — View your numbers\n\n**Profile & Settings**\n• **"Show my profile"** — View profile info\n• **"Show resume"** — View resume details\n• **"Preferences"** — View job preferences',
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
      if (command.action === 'start') {
        command.applyMode = selectedApplyMode;
      }
      await handleCommand(command, messageText);
    } else {
      addMessage({
        role: 'bot',
        content:
          "I'm not sure what you mean. Here are some things you can try:\n\n• **\"Easy apply 5 jobs\"**\n• **\"Apply 5 jobs based on my profile\"**\n• **\"click not now\"**\n• **\"Show status\"**\n• **\"Show my applications\"**\n• **\"Show my profile\"**\n• **\"Preferences\"**\n• **\"Help\"** for full command list",
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

  const isHeroMode = messages.length === 0 && !isProcessing;

  // ---- HERO STATE (no messages yet) ----
  if (isHeroMode) {
    return (
      <div className="flex flex-col h-full bg-background">
        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-16 pt-8">
          <div className="w-full max-w-2xl space-y-8">
            {/* Hero Title */}
            <div className="text-center space-y-2">
              <div className="flex justify-center mb-4">
                <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
                  <Sparkles className="h-7 w-7 text-primary" />
                </div>
              </div>
              <h1 className="text-3xl font-bold text-foreground tracking-tight">
                What should we apply for next?
              </h1>
              <p className="text-muted-foreground text-base">
                Your AI job application agent — powered by Codex
              </p>
            </div>

            {/* Mode Pills */}
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {([
                { label: 'Easy Apply', value: 'easy' },
                { label: 'Easy Apply (AI Resume)', value: 'easy_jd_resume' },
                { label: 'Apply (Manual)', value: 'apply' },
              ] as const).map((m) => (
                <button
                  key={m.value}
                  onClick={() => setSelectedApplyMode(m.value)}
                  className={cn(
                    'text-xs font-medium rounded-full px-4 py-1.5 transition border',
                    selectedApplyMode === m.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-surface text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {/* Big hero input */}
            <div className="relative flex items-end gap-3 bg-surface border border-border rounded-2xl p-3 shadow-md focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all">
              <textarea
                ref={inputRef as any}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={`Try "Easy apply 5 jobs", "Status", or "Help"...`}
                className="flex-1 min-h-[52px] max-h-40 resize-none bg-transparent px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground focus:outline-none scrollbar-hide leading-relaxed"
                disabled={isProcessing}
                rows={1}
                autoFocus
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isProcessing}
                className="w-11 h-11 shrink-0 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>

            {/* Quick action chips */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {quickActions.map((qa) => (
                <button
                  key={qa.label}
                  onClick={() => handleSend(qa.command)}
                  className="flex items-center gap-3 text-sm text-foreground bg-surface hover:bg-muted border border-border rounded-xl px-4 py-3 transition text-left"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background border border-border shrink-0">
                    <qa.icon className="h-4 w-4 text-primary" />
                  </div>
                  <span className="font-medium text-sm">{qa.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- EXPANDED CHAT STATE ----
  const showQuickActions = false;

  return (
    <div className="flex flex-col h-full max-h-screen bg-background">
      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-6">
        {recordingFrames.length > 0 && (
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Live Recording Timeline
              </p>
              <p className="text-xs font-medium text-muted-foreground">{recordingFrames.length} frames</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {recordingFrames.slice(0, 6).map((frame) => (
                <a
                  key={frame.id}
                  href={frame.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group overflow-hidden rounded-xl border border-border bg-background"
                >
                  <img
                    src={frame.url}
                    alt="Automation frame"
                    className="h-24 w-full object-cover transition duration-300 group-hover:scale-110"
                    loading="lazy"
                  />
                  <div className="px-3 py-1.5 text-[11px] font-medium text-muted-foreground bg-surface border-t border-border">
                    {new Date(frame.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {sessionGeneratedResumes.length > 0 && (
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Generated Resumes
              </p>
              <p className="text-xs font-medium text-muted-foreground">{sessionGeneratedResumes.length} resumes</p>
            </div>
            <div className="space-y-3">
              {sessionGeneratedResumes.slice(0, 5).map((item) => (
                <div key={item.resumeId} className="rounded-xl border border-border bg-background px-4 py-3">
                  <p className="text-sm font-bold text-foreground">{item.jobTitle} <span className="text-muted-foreground font-normal">• {item.company}</span></p>
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{item.fileName}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Suggestion chips when automation is running */}
        {automationStatus.isRunning && (
          <div className="flex gap-2 flex-wrap mb-4">
            {[
              { label: 'Status', cmd: 'status' },
              { label: 'Pause', cmd: 'pause' },
              { label: 'Record', cmd: 'start recording' },
              { label: 'Stop Rec', cmd: 'stop recording' },
              { label: 'Stop', cmd: 'stop', destructive: true },
            ].map((chip) => (
              <button
                key={chip.cmd}
                onClick={() => handleSend(chip.cmd)}
                disabled={isProcessing}
                className={cn(
                  "text-xs font-medium px-4 py-2 rounded-full transition disabled:opacity-50",
                  chip.destructive 
                    ? "bg-destructive/10 text-destructive hover:bg-destructive/20" 
                    : "bg-surface text-foreground hover:bg-border border border-border"
                )}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Quick Actions — shown only at the start */}
        {showQuickActions && !isProcessing && (
          <div className="pt-4 max-w-2xl mx-auto">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {quickActions.map((qa) => (
                <button
                  key={qa.label}
                  onClick={() => handleSend(qa.command)}
                  className="flex items-center gap-3 text-sm text-foreground bg-surface hover:bg-muted border border-border rounded-xl px-4 py-3.5 transition text-left"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-background border border-border">
                    <qa.icon className="h-4 w-4 text-primary" />
                  </div>
                  <span className="font-medium">{qa.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {isProcessing && (
          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full border border-border bg-surface flex items-center justify-center flex-shrink-0">
              <Sparkles className="h-4 w-4 text-primary animate-pulse" />
            </div>
            <div className="px-1 py-1">
              <div className="flex items-center gap-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Thinking...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} className="h-4" />
      </div>

      {/* Input Area */}
      <div className="px-4 sm:px-8 py-4 bg-background">
        <div className="max-w-4xl mx-auto relative">
          <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => setSelectedApplyMode('easy')}
              disabled={isProcessing}
              className={cn(
                'text-xs font-medium rounded-full px-4 py-1.5 transition border whitespace-nowrap',
                selectedApplyMode === 'easy'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-surface text-muted-foreground border-border hover:bg-muted hover:text-foreground'
              )}
            >
              Easy Apply
            </button>
            <button
              onClick={() => setSelectedApplyMode('easy_jd_resume')}
              disabled={isProcessing}
              className={cn(
                'text-xs font-medium rounded-full px-4 py-1.5 transition border whitespace-nowrap',
                selectedApplyMode === 'easy_jd_resume'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-surface text-muted-foreground border-border hover:bg-muted hover:text-foreground'
              )}
            >
              Easy Apply (AI Resume)
            </button>
            <button
              onClick={() => setSelectedApplyMode('apply')}
              disabled={isProcessing}
              className={cn(
                'text-xs font-medium rounded-full px-4 py-1.5 transition border whitespace-nowrap',
                selectedApplyMode === 'apply'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-surface text-muted-foreground border-border hover:bg-muted hover:text-foreground'
              )}
            >
              Apply (Manual)
            </button>
          </div>
          <div className="relative flex items-end gap-2 bg-surface border border-border rounded-3xl p-2 shadow-sm focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary transition-all">
            <textarea
              ref={inputRef as any}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder='Ask Codex to automate your applications...'
              className="flex-1 max-h-32 min-h-[40px] resize-none bg-transparent px-4 py-2.5 text-sm text-foreground focus:outline-none scrollbar-hide"
              disabled={isProcessing}
              rows={1}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isProcessing}
              className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            >
              <Send className="h-4 w-4 ml-0.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex flex-row-reverse items-start gap-4">
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0 shadow-sm">
          <User className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="max-w-[75%] bg-surface border border-border rounded-3xl rounded-tr-sm px-5 py-3.5 shadow-sm">
          <div className="text-sm text-foreground whitespace-pre-line leading-relaxed">
            {renderMarkdown(message.content)}
          </div>
        </div>
      </div>
    );
  }

  // Codex AI aesthetic: Transparent background, clean text, distinctive icon
  return (
    <div className="flex items-start gap-4 max-w-4xl">
      <div className="w-8 h-8 rounded-full border border-border bg-surface flex items-center justify-center flex-shrink-0 mt-1">
        <Sparkles className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 pt-1.5 pb-2">
        <div className="text-sm text-foreground whitespace-pre-line leading-[1.7] prose prose-sm dark:prose-invert max-w-none">
          {renderMarkdown(message.content)}
        </div>
      </div>
    </div>
  );
}

/** Simple markdown: **bold** support */
function renderMarkdown(text: string) {
  const boldParts = text.split(/(\*\*[^*]+\*\*)/g);

  return boldParts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={`b-${i}`} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }

    const urlParts = part.split(/(https?:\/\/[^\s]+)/g);
    return urlParts.map((chunk, j) => {
      if (/^https?:\/\//.test(chunk)) {
        return (
          <a
            key={`u-${i}-${j}`}
            href={chunk}
            target="_blank"
            rel="noreferrer"
            className="underline break-all"
          >
            {chunk}
          </a>
        );
      }
      return <span key={`t-${i}-${j}`}>{chunk}</span>;
    });
  });
}
