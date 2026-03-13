// In-memory data store for local development (no database required)
import { randomBytes } from 'crypto';

export function generateId() {
  return randomBytes(12).toString('hex');
}

export interface MockUser {
  _id: string;
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MockProfile {
  _id: string;
  userId: string;
  fullName: string;
  phone?: string;
  location?: string;
  skills: string[];
  experienceYears: number;
  preferredRoles: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MockJobPreferences {
  _id: string;
  userId: string;
  roles: string[];
  locations: string[];
  remoteOnly: boolean;
  minSalary?: number | null;
  maxSalary?: number | null;
  experienceLevel: string;
  jobTypes: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MockApplication {
  _id: string;
  id: string;
  userId: string;
  jobId: string;
  status: string;
  screenshotUrl?: string;
  appliedAt?: Date;
  errorMessage?: string;
  createdAt: Date;
}

export const db = {
  users: [] as MockUser[],
  profiles: [] as MockProfile[],
  preferences: [] as MockJobPreferences[],
  applications: [] as MockApplication[],
};
