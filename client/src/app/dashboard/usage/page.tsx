'use client';

import { useEffect, useMemo, useState } from 'react';
import { usageApi } from '@/lib/api';
import type { TaskRun } from '@/lib/types';
import { BarChart3, Coins, Database, Loader2 } from 'lucide-react';

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function formatMoney(value: number) {
  return `$${Number(value || 0).toFixed(4)}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function UsagePage() {
  const [rows, setRows] = useState<TaskRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await usageApi.listTasks(50);
        setRows(res.data || []);
      } catch (error) {
        console.error('Failed to load usage rows:', error);
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, []);

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.tasks += 1;
        acc.prompt += Number(row.prompt_tokens || 0);
        acc.completion += Number(row.completion_tokens || 0);
        acc.total += Number(row.total_tokens || 0);
        acc.cost += Number(row.total_cost_usd || 0);
        return acc;
      },
      { tasks: 0, prompt: 0, completion: 0, total: 0, cost: 0 }
    );
  }, [rows]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Usage</h1>
        <p className="text-gray-600">Task-wise token usage and model cost across dashboard, extension, and Telegram.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Tracked tasks</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{formatNumber(summary.tasks)}</p>
            </div>
            <BarChart3 className="h-8 w-8 text-primary-600" />
          </div>
        </div>
        <div className="rounded-2xl border bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Prompt tokens</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{formatNumber(summary.prompt)}</p>
            </div>
            <Database className="h-8 w-8 text-blue-600" />
          </div>
        </div>
        <div className="rounded-2xl border bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Completion tokens</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{formatNumber(summary.completion)}</p>
            </div>
            <Database className="h-8 w-8 text-green-600" />
          </div>
        </div>
        <div className="rounded-2xl border bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Estimated cost</p>
              <p className="mt-2 text-3xl font-bold text-gray-900">{formatMoney(summary.cost)}</p>
            </div>
            <Coins className="h-8 w-8 text-amber-600" />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border bg-white">
        <div className="border-b px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Recent tasks</h2>
          <p className="text-sm text-gray-500">Latest task runs mapped to your email/account.</p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center px-6 py-16 text-gray-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading usage...
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-16 text-center text-gray-500">
            No usage data yet. Start a task from the dashboard, extension, or Telegram.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-3 font-medium">Started</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Command</th>
                  <th className="px-4 py-3 font-medium">Model</th>
                  <th className="px-4 py-3 font-medium">Input</th>
                  <th className="px-4 py-3 font-medium">Output</th>
                  <th className="px-4 py-3 font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Cost</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t align-top">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">{formatDateTime(row.started_at)}</td>
                    <td className="px-4 py-3 capitalize text-gray-700">{row.source}</td>
                    <td className="px-4 py-3 text-gray-900">{row.command_text}</td>
                    <td className="px-4 py-3 text-gray-700">{row.model || '-'}</td>
                    <td className="px-4 py-3 text-gray-700">{formatNumber(row.prompt_tokens)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatNumber(row.completion_tokens)}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{formatNumber(row.total_tokens)}</td>
                    <td className="px-4 py-3 text-gray-900">{formatMoney(row.total_cost_usd)}</td>
                    <td className="px-4 py-3 capitalize text-gray-700">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
