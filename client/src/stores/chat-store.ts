import { create } from 'zustand';
import type { ChatMessage } from '@/lib/types';

interface ChatState {
  messages: ChatMessage[];
  addMessage: (msg: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  clearMessages: () => void;
}

let messageCounter = 0;

export const useChatStore = create<ChatState>((set) => ({
  messages: [
    {
      id: 'welcome',
      role: 'bot',
      content:
        "👋 Hi! I'm your **Job Assistant**. I can help you with:\n\n• **\"Apply 5 jobs based on my profile\"** — start automation\n• **\"Status\"** — check progress\n• **\"Show my applications\"** — recent history\n• **\"Show my profile\"** or **\"Preferences\"**\n• **\"Help\"** — full command list\n\nWhat would you like to do?",
      timestamp: new Date(),
    },
  ],

  addMessage: (msg) => {
    const id = `msg-${Date.now()}-${++messageCounter}`;
    set((state) => ({
      messages: [
        ...state.messages,
        { ...msg, id, timestamp: new Date() },
      ],
    }));
    return id;
  },

  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      ),
    })),

  clearMessages: () =>
    set({
      messages: [
        {
          id: 'welcome',
          role: 'bot',
          content:
            "👋 Hi! I'm your **Job Assistant**. I can help you with:\n\n• **\"Apply 5 jobs based on my profile\"** — start automation\n• **\"Status\"** — check progress\n• **\"Show my applications\"** — recent history\n• **\"Show my profile\"** or **\"Preferences\"**\n• **\"Help\"** — full command list\n\nWhat would you like to do?",
          timestamp: new Date(),
        },
      ],
    }),
}));
