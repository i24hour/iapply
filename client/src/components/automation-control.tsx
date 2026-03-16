'use client';

import { useState } from 'react';
import { useDashboardStore } from '@/stores/dashboard-store';
import { automationApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Play, Pause, Square, Loader2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AutomationControl() {
  const { automationStatus, setAutomationStatus, resume } = useDashboardStore();
  const [jobCount, setJobCount] = useState(10);
  const [isLoading, setIsLoading] = useState(false);

  const handleStart = async () => {
    if (!resume) {
      toast.error('Please upload your resume first');
      return;
    }

    setIsLoading(true);
    try {
      await automationApi.start(jobCount, {
        source: 'frontend',
        channel: 'dashboard_control',
        commandText: `apply ${jobCount} jobs`,
      });
      setAutomationStatus({ ...automationStatus, isRunning: true, currentAction: 'scrape_jobs' });
      toast.success(`Started applying to ${jobCount} jobs`);
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to start automation');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePause = async () => {
    setIsLoading(true);
    try {
      await automationApi.pause();
      setAutomationStatus({ ...automationStatus, isRunning: false });
      toast.success('Automation paused');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to pause automation');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    setIsLoading(true);
    try {
      await automationApi.stop();
      setAutomationStatus({
        isRunning: false,
        jobsScraped: 0,
        jobsApplied: 0,
        jobsFailed: 0,
      });
      toast.success('Automation stopped');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to stop automation');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center',
            automationStatus.isRunning ? 'bg-green-100' : 'bg-gray-100'
          )}>
            <Zap className={cn(
              'h-5 w-5',
              automationStatus.isRunning ? 'text-green-600' : 'text-gray-400'
            )} />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Automation Control</h2>
            <p className="text-sm text-gray-600">
              {automationStatus.isRunning
                ? `Running: ${automationStatus.currentAction?.replace('_', ' ')}`
                : 'Ready to start'}
            </p>
          </div>
        </div>

        {automationStatus.isRunning && (
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
            <span className="text-sm text-green-600 font-medium">Active</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        {!automationStatus.isRunning ? (
          <>
            <div className="flex items-center gap-2">
              <label htmlFor="jobCount" className="text-sm text-gray-600">
                Apply to
              </label>
              <select
                id="jobCount"
                value={jobCount}
                onChange={(e) => setJobCount(Number(e.target.value))}
                className="border rounded-lg px-3 py-2 text-sm focus:ring-primary-500 focus:border-primary-500"
              >
                <option value={5}>5 jobs</option>
                <option value={10}>10 jobs</option>
                <option value={25}>25 jobs</option>
                <option value={50}>50 jobs</option>
              </select>
            </div>
            <button
              onClick={handleStart}
              disabled={isLoading}
              className="flex items-center gap-2 bg-primary-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-primary-700 transition disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Play className="h-5 w-5" />
              )}
              Start Applying
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handlePause}
              disabled={isLoading}
              className="flex items-center gap-2 bg-yellow-500 text-white px-6 py-2 rounded-lg font-medium hover:bg-yellow-600 transition disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Pause className="h-5 w-5" />
              )}
              Pause
            </button>
            <button
              onClick={handleStop}
              disabled={isLoading}
              className="flex items-center gap-2 bg-red-500 text-white px-6 py-2 rounded-lg font-medium hover:bg-red-600 transition disabled:opacity-50"
            >
              <Square className="h-5 w-5" />
              Stop
            </button>
          </>
        )}
      </div>

      {automationStatus.isRunning && (
        <div className="mt-6 pt-6 border-t">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">Progress</span>
            <span className="font-medium">
              {automationStatus.jobsApplied} / {automationStatus.jobsScraped} jobs
            </span>
          </div>
          <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-primary-600 h-2 rounded-full transition-all"
              style={{
                width: `${automationStatus.jobsScraped > 0
                  ? (automationStatus.jobsApplied / automationStatus.jobsScraped) * 100
                  : 0}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
