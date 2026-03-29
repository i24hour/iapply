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
    <div className="flex flex-col h-full bg-background relative max-w-full">
      <div className="sticky top-0 z-10 border-b border-border bg-background/80 px-4 py-3 backdrop-blur-md hidden xl:block">
        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">Codex Assistant</h1>
      </div>
      
      <div className="flex-1 w-full max-w-full overflow-hidden">
        <ChatBot />
      </div>
    </div>
  );
}
