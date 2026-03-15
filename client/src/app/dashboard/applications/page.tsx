'use client';

import { useState, useEffect } from 'react';
import { applicationsApi } from '@/lib/api';
import { getStatusColor, truncate } from '@/lib/utils';
import { formatDate } from '@/lib/types';
import type { Application } from '@/lib/types';
import { Loader2, ExternalLink, Image, Search, Filter } from 'lucide-react';

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    const fetchApplications = async () => {
      setIsLoading(true);
      try {
        const res = await applicationsApi.list(page, 20);
        setApplications(res.data.items);
        setTotalPages(res.data.totalPages);
      } catch (error) {
        console.error('Failed to fetch applications:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchApplications();
  }, [page]);

  const filteredApplications = applications.filter((app) => {
    const matchesSearch =
      !searchQuery ||
      app.job?.company?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.job?.title?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || app.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  return (
    <div>
      <div className="mb-6 sm:mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Applications</h1>
          <p className="text-gray-600">Track all your job applications</p>
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by company or position..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-gray-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 focus:ring-primary-500 focus:border-primary-500 sm:w-auto"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="applying">Applying</option>
            <option value="applied">Applied</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped</option>
          </select>
        </div>
      </div>

      {/* Applications Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      ) : filteredApplications.length === 0 ? (
        <div className="bg-white border rounded-xl p-12 text-center">
          <p className="text-gray-500 text-lg">No applications found</p>
          <p className="text-gray-400 mt-2">
            {applications.length === 0
              ? 'Start automation to apply to jobs automatically.'
              : 'Try adjusting your filters.'}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3 md:hidden">
            {filteredApplications.map((app) => (
              <div key={app.id} className="rounded-xl border bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{app.job?.company || 'Unknown'}</p>
                    <p className="mt-1 text-sm text-gray-600">
                      {truncate(app.job?.title || 'Unknown Position', 50)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(
                      app.status
                    )}`}
                  >
                    {app.status}
                  </span>
                </div>

                <div className="mt-3 space-y-1 text-sm text-gray-500">
                  <p>{app.job?.location || 'Location not provided'}</p>
                  <p>{app.appliedAt ? formatDate(app.appliedAt) : '-'}</p>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  {app.job?.url && (
                    <a
                      href={app.job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-sm text-primary-600 transition hover:text-primary-700"
                      title="View job posting"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Job post
                    </a>
                  )}
                  {app.screenshotUrl && (
                    <button
                      className="inline-flex items-center gap-2 text-sm text-gray-500 transition hover:text-primary-600"
                      title="View screenshot"
                    >
                      <Image className="h-4 w-4" />
                      Screenshot
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-xl border bg-white md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Company</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Position</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Location</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Applied</th>
                    <th className="px-6 py-3 text-left text-sm font-medium text-gray-600"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredApplications.map((app) => (
                    <tr key={app.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <span className="font-medium">{app.job?.company || 'Unknown'}</span>
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {truncate(app.job?.title || 'Unknown Position', 40)}
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {app.job?.location || '-'}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(
                            app.status
                          )}`}
                        >
                          {app.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-600 text-sm">
                        {app.appliedAt ? formatDate(app.appliedAt) : '-'}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          {app.job?.url && (
                            <a
                              href={app.job.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gray-400 transition hover:text-primary-600"
                              title="View job posting"
                            >
                              <ExternalLink className="h-5 w-5" />
                            </a>
                          )}
                          {app.screenshotUrl && (
                            <button
                              className="text-gray-400 transition hover:text-primary-600"
                              title="View screenshot"
                            >
                              <Image className="h-5 w-5" />
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
        </>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-4 py-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-center text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
