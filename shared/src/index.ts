export * from './types';

// Constants
export const JOB_PLATFORMS = ['linkedin', 'naukri', 'internshala'] as const;
export const EXPERIENCE_LEVELS = ['entry', 'mid', 'senior', 'lead', 'any'] as const;
export const JOB_TYPES = ['full-time', 'part-time', 'contract', 'internship'] as const;
export const APPLICATION_STATUSES = ['pending', 'applying', 'applied', 'failed', 'skipped'] as const;

// Validation helpers
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const isValidPassword = (password: string): boolean => {
  return password.length >= 8;
};

// Formatting helpers
export const formatDate = (date: Date | string): string => {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const formatDateTime = (date: Date | string): string => {
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
