import axios from 'axios';
import type { TaskRun } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Unwrap { success, data } envelope from backend responses
api.interceptors.response.use(
  (response) => {
    if (
      response.data &&
      typeof response.data === 'object' &&
      'success' in response.data &&
      'data' in response.data
    ) {
      response.data = response.data.data;
    }
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        // Don't clear auth or redirect if already on auth pages
        if (path !== '/login' && path !== '/signup') {
          localStorage.removeItem('auth_token');
          localStorage.removeItem('auth-storage');
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

// API methods
export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  signup: (fullName: string, email: string, password: string) =>
    api.post('/auth/signup', { fullName, email, password }),
  me: () => api.get('/auth/me'),
  linkTelegram: (telegramId: string | number) =>
    api.post('/auth/link-telegram', { telegramId }),
};

export const profileApi = {
  get: () => api.get('/profile'),
  update: (data: any) => api.put('/profile', data),
};

export const resumeApi = {
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('resume', file);
    return api.post('/resume/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  get: () => api.get('/resume'),
};

export const preferencesApi = {
  get: () => api.get('/preferences'),
  update: (data: any) => api.put('/preferences', data),
};

export const automationApi = {
  start: (
    count: number,
    options?: {
      source?: 'frontend' | 'extension' | 'telegram';
      channel?: string;
      commandText?: string;
      searchQuery?: string;
      provider?: string;
      model?: string;
      apiKey?: string;
      baseUrl?: string;
    }
  ) => api.post('/automation/start', { count, ...options }),
  pause: () => api.post('/automation/pause'),
  stop: () => api.post('/automation/stop'),
  status: () => api.get('/automation/status'),
};

export const extensionApi = {
  live: (logs = 30, screenshots = 3, recordings = 12) =>
    api.get('/agent/live', { params: { logs, screenshots, recordings } }),
  requestScreenshot: () =>
    api.post('/agent/request-screenshot'),
  manualClick: (targetText: string) =>
    api.post('/agent/manual-click', { targetText }),
  startRecording: () =>
    api.post('/agent/start-recording'),
  stopRecording: () =>
    api.post('/agent/stop-recording'),
};

export const applicationsApi = {
  list: (page = 1, pageSize = 10) =>
    api.get(`/applications?page=${page}&pageSize=${pageSize}`),
  get: (id: string) => api.get(`/applications/${id}`),
};

export const usageApi = {
  listTasks: (limit = 20) => api.get<TaskRun[]>(`/usage/tasks?limit=${limit}`),
};
