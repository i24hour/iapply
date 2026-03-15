'use client';

import Link from 'next/link';
import type { Application } from '@/lib/types';
import { getStatusColor, truncate } from '@/lib/utils';
import { formatDate } from '@/lib/types';
import { ExternalLink, Image } from 'lucide-react';

interface RecentApplicationsProps {
  applications: Application[];
}

export function RecentApplications({ applications }: RecentApplicationsProps) {
  if (applications.length === 0) {
    return (
      <div className="bg-white rounded-xl border p-6">
        <h2 className="text-lg font-semibold mb-4">Recent Applications</h2>
        <div className="text-center py-8 text-gray-500">
          <p>No applications yet.</p>
          <p className="text-sm mt-1">Start automation to apply to jobs automatically.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Recent Applications</h2>
        <Link
          href="/dashboard/applications"
          className="text-sm text-primary-600 hover:text-primary-700"
        >
          View all →
        </Link>
      </div>

      <div className="space-y-3 md:hidden">
        {applications.map((app) => (
          <div key={app.id} className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{app.job?.company || 'Unknown'}</p>
                <p className="mt-1 text-sm text-gray-600">
                  {truncate(app.job?.title || 'Unknown Position', 45)}
                </p>
              </div>
              <span className={`inline-flex shrink-0 px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(app.status)}`}>
                {app.status}
              </span>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm text-gray-500">
                {app.appliedAt ? formatDate(app.appliedAt) : '-'}
              </p>
              <div className="flex items-center gap-2">
                {app.job?.url && (
                  <a
                    href={app.job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-gray-600"
                    title="View job posting"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                {app.screenshotUrl && (
                  <button
                    className="text-gray-400 hover:text-gray-600"
                    title="View screenshot"
                  >
                    <Image className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b text-left">
              <th className="pb-3 font-medium text-gray-600">Company</th>
              <th className="pb-3 font-medium text-gray-600">Position</th>
              <th className="pb-3 font-medium text-gray-600">Status</th>
              <th className="pb-3 font-medium text-gray-600">Applied</th>
              <th className="pb-3 font-medium text-gray-600"></th>
            </tr>
          </thead>
          <tbody>
            {applications.map((app) => (
              <tr key={app.id} className="border-b last:border-0">
                <td className="py-3">
                  <span className="font-medium">{app.job?.company || 'Unknown'}</span>
                </td>
                <td className="py-3 text-gray-600">
                  {truncate(app.job?.title || 'Unknown Position', 30)}
                </td>
                <td className="py-3">
                  <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(app.status)}`}>
                    {app.status}
                  </span>
                </td>
                <td className="py-3 text-gray-600 text-sm">
                  {app.appliedAt ? formatDate(app.appliedAt) : '-'}
                </td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    {app.job?.url && (
                      <a
                        href={app.job.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-400 hover:text-gray-600"
                        title="View job posting"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    {app.screenshotUrl && (
                      <button
                        className="text-gray-400 hover:text-gray-600"
                        title="View screenshot"
                      >
                        <Image className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
