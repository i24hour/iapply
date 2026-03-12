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
        'Hi! I\'m your job automation assistant. You can tell me things like:\n• "Apply to 5 jobs"\n• "Start applying"\n• "Pause automation"\n• "Stop"\n• "Show status"\n• "Show my applications"',
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
            'Hi! I\'m your job automation assistant. You can tell me things like:\n• "Apply to 5 jobs"\n• "Start applying"\n• "Pause automation"\n• "Stop"\n• "Show status"\n• "Show my applications"',
          timestamp: new Date(),
        },
      ],
    }),
}));
