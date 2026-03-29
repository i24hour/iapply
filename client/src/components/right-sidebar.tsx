'use client';

import { useDashboardStore } from '@/stores/dashboard-store';
import { StatsCard } from '@/components/stats-card';
import { QuickSetup } from '@/components/quick-setup';
import { Briefcase, CheckCircle, XCircle, Clock } from 'lucide-react';
import { usePathname } from 'next/navigation';

export function RightSidebar() {
  const { automationStatus, resume, profile } = useDashboardStore();
  const pathname = usePathname();
  
  // Quick setup should only show if something is missing
  const needsSetup = !resume || !profile;

  return (
    <div className="space-y-6">
      {needsSetup && <QuickSetup hasResume={!!resume} hasProfile={!!profile} />}

      <div className="rounded-2xl border border-border bg-surface p-4">
        <h2 className="mb-4 text-lg font-bold">Automation Stats</h2>
        <div className="grid grid-cols-2 gap-4">
          <StatsCard
            title="Applied"
            value={automationStatus.jobsApplied}
            icon={<CheckCircle className="h-5 w-5 text-green-500" />}
            color="green"
          />
          <StatsCard
            title="Scraped"
            value={automationStatus.jobsScraped}
            icon={<Briefcase className="h-5 w-5 text-primary" />}
            color="blue"
          />
          <StatsCard
            title="In Queue"
            value={Math.max(0, automationStatus.jobsScraped - automationStatus.jobsApplied - automationStatus.jobsFailed)}
            icon={<Clock className="h-5 w-5 text-yellow-500" />}
            color="yellow"
          />
          <StatsCard
            title="Failed"
            value={automationStatus.jobsFailed}
            icon={<XCircle className="h-5 w-5 text-red-500" />}
            color="red"
          />
        </div>
      </div>
      
      {/* Premium Banner Placeholder */}
      <div className="rounded-2xl border border-border bg-surface p-4 text-center">
        <h3 className="font-bold">Upgrade to Premium</h3>
        <p className="mt-1 text-sm text-muted-foreground">Unlock unlimited AI job applications and advanced analytics.</p>
        <button className="mt-3 w-full rounded-full bg-primary py-2 font-bold text-primary-foreground hover:bg-primary/90 transition">
          Subscribe
        </button>
      </div>
    </div>
  );
}
