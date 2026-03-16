// Shared types used across the frontend

export interface User {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Profile {
  userId: string;
  fullName: string;
  phone?: string;
  location?: string;
  skills: string[];
  experienceYears: number;
  preferredRoles: string[];
}

export interface Resume {
  id: string;
  userId: string;
  fileName: string;
  fileUrl: string;
  parsedData?: Record<string, any>;
  uploadedAt: Date;
}

export interface JobPreferences {
  userId: string;
  roles: string[];
  locations: string[];
  remoteOnly: boolean;
  minSalary?: number;
  maxSalary?: number;
  experienceLevel: ExperienceLevel;
  jobTypes: JobType[];
}

export type ExperienceLevel = 'entry' | 'mid' | 'senior' | 'lead' | 'any';
export type JobType = 'full-time' | 'part-time' | 'contract' | 'internship';

export interface Job {
  id: string;
  platform: string;
  externalId: string;
  company: string;
  title: string;
  description: string;
  location: string;
  url: string;
  salary?: string;
  isEasyApply: boolean;
  postedAt?: Date;
}

export interface Application {
  id: string;
  userId: string;
  jobId: string;
  job?: Job;
  status: ApplicationStatus;
  screenshotUrl?: string;
  appliedAt?: Date;
  errorMessage?: string;
  createdAt: Date;
}

export type ApplicationStatus = 'pending' | 'applying' | 'applied' | 'failed' | 'skipped';

export interface ChatMessage {
  id: string;
  role: 'user' | 'bot';
  content: string;
  timestamp: Date;
}

export interface AutomationStatus {
  isRunning: boolean;
  currentAction?: string;
  jobsScraped: number;
  jobsApplied: number;
  jobsFailed: number;
  startedAt?: Date;
}

export interface TaskRun {
  id: string;
  user_id: string;
  user_email: string;
  source: 'frontend' | 'extension' | 'telegram';
  channel: string;
  command_text: string;
  provider?: string | null;
  model?: string | null;
  status: 'queued' | 'running' | 'completed' | 'stopped' | 'error';
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  input_cost_usd: number;
  output_cost_usd: number;
  total_cost_usd: number;
  started_at: string;
  last_activity_at?: string | null;
  completed_at?: string | null;
}

export function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
