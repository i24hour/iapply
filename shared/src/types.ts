// User & Auth Types
export interface User {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  email: string;
  password: string;
  fullName: string;
}

// Profile Types
export interface Profile {
  userId: string;
  fullName: string;
  phone?: string;
  location?: string;
  skills: string[];
  experienceYears: number;
  preferredRoles: string[];
  education: Education[];
  workExperience: WorkExperience[];
}

export interface Education {
  institution: string;
  degree: string;
  field: string;
  startYear: number;
  endYear?: number;
}

export interface WorkExperience {
  company: string;
  title: string;
  location?: string;
  startDate: string;
  endDate?: string;
  description?: string;
}

// Resume Types
export interface Resume {
  id: string;
  userId: string;
  fileName: string;
  fileUrl: string;
  parsedData?: ParsedResume;
  uploadedAt: Date;
}

export interface ParsedResume {
  fullName: string;
  email: string;
  phone?: string;
  location?: string;
  skills: string[];
  experienceYears: number;
  education: Education[];
  workExperience: WorkExperience[];
  summary?: string;
}

// Job Preferences Types
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

// Job Types
export interface Job {
  id: string;
  platform: JobPlatform;
  externalId: string;
  company: string;
  title: string;
  description: string;
  location: string;
  url: string;
  salary?: string;
  isEasyApply: boolean;
  postedAt?: Date;
  scrapedAt: Date;
}

export type JobPlatform = 'linkedin' | 'naukri' | 'internshala';

export interface ScoredJob extends Job {
  matchScore: number;
  matchReasons: string[];
}

// Application Types
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

// Automation Types
export interface AutomationCommand {
  id: string;
  action: AutomationAction;
  payload: AutomationPayload;
  status: CommandStatus;
  createdAt: Date;
}

export type AutomationAction = 'scrape_jobs' | 'apply_jobs' | 'pause' | 'stop';
export type CommandStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface AutomationPayload {
  roles?: string[];
  locations?: string[];
  count?: number;
  jobs?: ScoredJob[];
}

export interface AutomationStatus {
  isRunning: boolean;
  currentAction?: AutomationAction;
  jobsScraped: number;
  jobsApplied: number;
  jobsFailed: number;
  startedAt?: Date;
}

// Extension Communication Types
export interface ExtensionCommand {
  id: string;
  action: AutomationAction;
  payload: AutomationPayload;
}

export interface ExtensionJobsSubmission {
  jobs: Omit<Job, 'id'>[];
}

export interface ExtensionApplicationResult {
  jobId: string;
  success: boolean;
  screenshotBase64?: string;
  errorMessage?: string;
}

// AI Service Types
export interface ParseResumeRequest {
  fileBase64: string;
  fileName: string;
}

export interface ParseResumeResponse {
  success: boolean;
  data?: ParsedResume;
  error?: string;
}

export interface MatchJobRequest {
  profile: Profile;
  job: Job;
}

export interface MatchJobResponse {
  score: number;
  reasons: string[];
}

export interface GenerateAnswerRequest {
  question: string;
  fieldType: 'text' | 'textarea' | 'select' | 'radio';
  options?: string[];
  profile: Profile;
  jobDescription: string;
}

export interface GenerateAnswerResponse {
  answer: string;
  confidence: number;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
