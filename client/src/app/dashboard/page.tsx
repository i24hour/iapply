'use client';

import { useEffect, useState } from 'react';
import { useDashboardStore } from '@/stores/dashboard-store';
import { automationApi, applicationsApi, profileApi, resumeApi } from '@/lib/api';
import { ChatBot } from '@/components/chat-bot';

export default function DashboardPage() {
  const {
    automationStatus,
    setAutomationStatus,
    setApplications,
    setResume,
    setProfile,
  } = useDashboardStore();

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statusRes, appsRes, resumeRes, profileRes] = await Promise.all([
          automationApi.status().catch(() => null),
          applicationsApi.list(1, 5).catch(() => null),
          resumeApi.get().catch(() => null),
          profileApi.get().catch(() => null),
        ]);

        if (statusRes?.data) setAutomationStatus(statusRes.data);
        if (appsRes?.data?.items) setApplications(appsRes.data.items);
        if (resumeRes?.data) setResume(resumeRes.data);
        if (profileRes?.data) setProfile(profileRes.data);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();

    // Poll for status updates when automation is running
    const interval = setInterval(async () => {
      if (automationStatus.isRunning) {
        try {
          const res = await automationApi.status();
          if (res.data) setAutomationStatus(res.data);
        } catch (error) {
          console.error('Failed to fetch automation status:', error);
        }
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [automationStatus.isRunning]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background">
      <div className="sticky top-0 z-10 border-b border-border bg-background/90 px-6 py-3 backdrop-blur-md flex items-center gap-3">
        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        <h1 className="text-sm font-bold text-foreground tracking-wide uppercase">Codex / Job Assistant</h1>
      </div>
      <div className="flex-1 overflow-hidden">
        <ChatBot />
      </div>
    </div>
  );
}
