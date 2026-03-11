import { create } from 'zustand';
import type { AutomationStatus, Application, Profile, Resume, JobPreferences } from '@/lib/types';

interface DashboardState {
  // Profile
  profile: Profile | null;
  setProfile: (profile: Profile) => void;

  // Resume
  resume: Resume | null;
  setResume: (resume: Resume) => void;

  // Preferences
  preferences: JobPreferences | null;
  setPreferences: (preferences: JobPreferences) => void;

  // Automation
  automationStatus: AutomationStatus;
  setAutomationStatus: (status: AutomationStatus) => void;

  // Applications
  applications: Application[];
  setApplications: (applications: Application[]) => void;
  addApplication: (application: Application) => void;
  updateApplication: (id: string, updates: Partial<Application>) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  // Profile
  profile: null,
  setProfile: (profile) => set({ profile }),

  // Resume
  resume: null,
  setResume: (resume) => set({ resume }),

  // Preferences
  preferences: null,
  setPreferences: (preferences) => set({ preferences }),

  // Automation
  automationStatus: {
    isRunning: false,
    jobsScraped: 0,
    jobsApplied: 0,
    jobsFailed: 0,
  },
  setAutomationStatus: (automationStatus) => set({ automationStatus }),

  // Applications
  applications: [],
  setApplications: (applications) => set({ applications }),
  addApplication: (application) =>
    set((state) => ({ applications: [application, ...state.applications] })),
  updateApplication: (id, updates) =>
    set((state) => ({
      applications: state.applications.map((app) =>
        app.id === id ? { ...app, ...updates } : app
      ),
    })),
}));
