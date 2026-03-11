'use client';

import { useState, useEffect } from 'react';
import { useDashboardStore } from '@/stores/dashboard-store';
import { preferencesApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Loader2, Save } from 'lucide-react';
import type { ExperienceLevel, JobType } from '@/lib/types';

export default function PreferencesPage() {
  const { preferences, setPreferences } = useDashboardStore();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    roles: [] as string[],
    locations: [] as string[],
    remoteOnly: false,
    minSalary: 0,
    maxSalary: 0,
    experienceLevel: 'any' as ExperienceLevel,
    jobTypes: ['full-time'] as JobType[],
  });
  const [roleInput, setRoleInput] = useState('');
  const [locationInput, setLocationInput] = useState('');

  useEffect(() => {
    const fetchPreferences = async () => {
      setIsLoading(true);
      try {
        const res = await preferencesApi.get();
        if (res.data) {
          setPreferences(res.data);
          setFormData({
            roles: res.data.roles || [],
            locations: res.data.locations || [],
            remoteOnly: res.data.remoteOnly || false,
            minSalary: res.data.minSalary || 0,
            maxSalary: res.data.maxSalary || 0,
            experienceLevel: res.data.experienceLevel || 'any',
            jobTypes: res.data.jobTypes || ['full-time'],
          });
        }
      } catch (error) {
        // Preferences might not exist yet
      } finally {
        setIsLoading(false);
      }
    };

    fetchPreferences();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const res = await preferencesApi.update(formData);
      setPreferences(res.data);
      toast.success('Preferences saved successfully!');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to save preferences');
    } finally {
      setIsSaving(false);
    }
  };

  const addRole = () => {
    if (roleInput.trim() && !formData.roles.includes(roleInput.trim())) {
      setFormData({ ...formData, roles: [...formData.roles, roleInput.trim()] });
      setRoleInput('');
    }
  };

  const removeRole = (role: string) => {
    setFormData({ ...formData, roles: formData.roles.filter((r) => r !== role) });
  };

  const addLocation = () => {
    if (locationInput.trim() && !formData.locations.includes(locationInput.trim())) {
      setFormData({ ...formData, locations: [...formData.locations, locationInput.trim()] });
      setLocationInput('');
    }
  };

  const removeLocation = (location: string) => {
    setFormData({ ...formData, locations: formData.locations.filter((l) => l !== location) });
  };

  const toggleJobType = (type: JobType) => {
    if (formData.jobTypes.includes(type)) {
      setFormData({ ...formData, jobTypes: formData.jobTypes.filter((t) => t !== type) });
    } else {
      setFormData({ ...formData, jobTypes: [...formData.jobTypes, type] });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Job Preferences</h1>
      <p className="text-gray-600 mb-8">
        Set your job search preferences to match with relevant opportunities.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Target Roles */}
        <div className="bg-white border rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Target Roles</h2>
          <p className="text-sm text-gray-600">What job titles are you looking for?</p>

          <div className="flex gap-2">
            <input
              type="text"
              value={roleInput}
              onChange={(e) => setRoleInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addRole())}
              className="flex-1 px-4 py-2 border rounded-lg focus:ring-primary-500 focus:border-primary-500"
              placeholder="e.g., Software Engineer, Data Analyst..."
            />
            <button
              type="button"
              onClick={addRole}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
            >
              Add
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {formData.roles.map((role, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 bg-primary-100 text-primary-700 px-3 py-1 rounded-full text-sm"
              >
                {role}
                <button
                  type="button"
                  onClick={() => removeRole(role)}
                  className="hover:text-primary-900"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Locations */}
        <div className="bg-white border rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Locations</h2>
          <p className="text-sm text-gray-600">Where do you want to work?</p>

          <div className="flex gap-2">
            <input
              type="text"
              value={locationInput}
              onChange={(e) => setLocationInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addLocation())}
              className="flex-1 px-4 py-2 border rounded-lg focus:ring-primary-500 focus:border-primary-500"
              placeholder="e.g., New York, San Francisco..."
            />
            <button
              type="button"
              onClick={addLocation}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
            >
              Add
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {formData.locations.map((location, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm"
              >
                {location}
                <button
                  type="button"
                  onClick={() => removeLocation(location)}
                  className="hover:text-green-900"
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.remoteOnly}
              onChange={(e) => setFormData({ ...formData, remoteOnly: e.target.checked })}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <span className="text-sm text-gray-700">Remote positions only</span>
          </label>
        </div>

        {/* Job Type & Experience */}
        <div className="bg-white border rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Job Type & Experience</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Job Type</label>
            <div className="flex flex-wrap gap-2">
              {(['full-time', 'part-time', 'contract', 'internship'] as JobType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleJobType(type)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                    formData.jobTypes.includes(type)
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Experience Level</label>
            <select
              value={formData.experienceLevel}
              onChange={(e) => setFormData({ ...formData, experienceLevel: e.target.value as ExperienceLevel })}
              className="w-full px-4 py-2 border rounded-lg focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="any">Any Level</option>
              <option value="entry">Entry Level (0-2 years)</option>
              <option value="mid">Mid Level (3-5 years)</option>
              <option value="senior">Senior Level (6-10 years)</option>
              <option value="lead">Lead/Principal (10+ years)</option>
            </select>
          </div>
        </div>

        {/* Salary Range */}
        <div className="bg-white border rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Salary Expectations (Optional)</h2>
          <p className="text-sm text-gray-600">Annual salary in your preferred currency</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Minimum</label>
              <input
                type="number"
                min="0"
                value={formData.minSalary || ''}
                onChange={(e) => setFormData({ ...formData, minSalary: Number(e.target.value) })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-primary-500 focus:border-primary-500"
                placeholder="50000"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Maximum</label>
              <input
                type="number"
                min="0"
                value={formData.maxSalary || ''}
                onChange={(e) => setFormData({ ...formData, maxSalary: Number(e.target.value) })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-primary-500 focus:border-primary-500"
                placeholder="100000"
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isSaving}
          className="flex items-center gap-2 bg-primary-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-primary-700 transition disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-5 w-5" />
              Save Preferences
            </>
          )}
        </button>
      </form>
    </div>
  );
}
