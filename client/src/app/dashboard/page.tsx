'use client';

import { useEffect, useState } from 'react';
import { useDashboardStore } from '@/stores/dashboard-store';
import { automationApi, applicationsApi, profileApi, resumeApi } from '@/lib/api';
import { ChatBot } from '@/components/chat-bot';
import { StatsCard } from '@/components/stats-card';
import { QuickSetup } from '@/components/quick-setup';
import { Briefcase, CheckCircle, XCircle, Clock } from 'lucide-react';

export default function DashboardPage() {
  const {
    automationStatus,
    setAutomationStatus,
    applications,
    setApplications,
    resume,
    setResume,
    profile,
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

  const needsSetup = !resume || !profile;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">Chat with your job assistant to manage applications</p>
        </div>
      </div>

      {needsSetup && !isLoading && <QuickSetup hasResume={!!resume} hasProfile={!!profile} />}

      {/* Stats Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard
          title="Applied"
          value={automationStatus.jobsApplied}
          icon={<CheckCircle className="h-5 w-5 text-green-600" />}
          color="green"
        />
        <StatsCard
          title="Scraped"
          value={automationStatus.jobsScraped}
          icon={<Briefcase className="h-5 w-5 text-blue-600" />}
          color="blue"
        />
        <StatsCard
          title="Failed"
          value={automationStatus.jobsFailed}
          icon={<XCircle className="h-5 w-5 text-red-600" />}
          color="red"
        />
        <StatsCard
          title="In Queue"
          value={automationStatus.jobsScraped - automationStatus.jobsApplied - automationStatus.jobsFailed}
          icon={<Clock className="h-5 w-5 text-yellow-600" />}
          color="yellow"
        />
      </div>

      {/* Chat Bot — primary interface */}
      <ChatBot />
    </div>
  );
}
