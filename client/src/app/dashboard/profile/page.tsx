'use client';

import { useState, useEffect } from 'react';
import { useDashboardStore } from '@/stores/dashboard-store';
import { profileApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Loader2, Save } from 'lucide-react';

export default function ProfilePage() {
  const { profile, setProfile, resume } = useDashboardStore();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    location: '',
    skills: [] as string[],
    experienceYears: 0,
    preferredRoles: [] as string[],
  });
  const [skillInput, setSkillInput] = useState('');
  const [roleInput, setRoleInput] = useState('');

  useEffect(() => {
    const fetchProfile = async () => {
      setIsLoading(true);
      try {
        const res = await profileApi.get();
        if (res.data) {
          setProfile(res.data);
          setFormData({
            fullName: res.data.fullName || '',
            phone: res.data.phone || '',
            location: res.data.location || '',
            skills: res.data.skills || [],
            experienceYears: res.data.experienceYears || 0,
            preferredRoles: res.data.preferredRoles || [],
          });
        }
      } catch (error) {
        // Profile might not exist yet, that's okay
        // Pre-fill from resume if available
        if (resume?.parsedData) {
          setFormData({
            fullName: resume.parsedData.fullName || '',
            phone: resume.parsedData.phone || '',
            location: resume.parsedData.location || '',
            skills: resume.parsedData.skills || [],
            experienceYears: resume.parsedData.experienceYears || 0,
            preferredRoles: [],
          });
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchProfile();
  }, [resume]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const res = await profileApi.update(formData);
      setProfile(res.data);
      toast.success('Profile updated successfully!');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const addSkill = () => {
    if (skillInput.trim() && !formData.skills.includes(skillInput.trim())) {
      setFormData({ ...formData, skills: [...formData.skills, skillInput.trim()] });
      setSkillInput('');
    }
  };

  const removeSkill = (skill: string) => {
    setFormData({ ...formData, skills: formData.skills.filter((s) => s !== skill) });
  };

  const addRole = () => {
    if (roleInput.trim() && !formData.preferredRoles.includes(roleInput.trim())) {
      setFormData({ ...formData, preferredRoles: [...formData.preferredRoles, roleInput.trim()] });
      setRoleInput('');
    }
  };

  const removeRole = (role: string) => {
    setFormData({ ...formData, preferredRoles: formData.preferredRoles.filter((r) => r !== role) });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Profile</h1>
      <p className="text-gray-600 mb-8">
        Your profile information is used to fill out job applications.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <div className="bg-white border rounded-xl p-4 sm:p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Basic Information</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Full Name
              </label>
              <input
                type="text"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-primary-500 focus:border-primary-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Location
            </label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              className="w-full px-4 py-2 border rounded-lg focus:ring-primary-500 focus:border-primary-500"
              placeholder="e.g., San Francisco, CA or Remote"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Years of Experience
            </label>
            <input
              type="number"
              min="0"
              max="50"
              value={formData.experienceYears}
              onChange={(e) => setFormData({ ...formData, experienceYears: Number(e.target.value) })}
              className="w-full px-4 py-2 border rounded-lg focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        </div>

        {/* Skills */}
        <div className="bg-white border rounded-xl p-4 sm:p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Skills</h2>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSkill())}
              className="flex-1 px-4 py-2 border rounded-lg focus:ring-primary-500 focus:border-primary-500"
              placeholder="Add a skill..."
            />
            <button
              type="button"
              onClick={addSkill}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition sm:w-auto"
            >
              Add
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {formData.skills.map((skill, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 bg-primary-100 text-primary-700 px-3 py-1 rounded-full text-sm"
              >
                {skill}
                <button
                  type="button"
                  onClick={() => removeSkill(skill)}
                  className="hover:text-primary-900"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Preferred Roles */}
        <div className="bg-white border rounded-xl p-4 sm:p-6 space-y-4">
          <h2 className="font-semibold text-gray-900">Preferred Roles</h2>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={roleInput}
              onChange={(e) => setRoleInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addRole())}
              className="flex-1 px-4 py-2 border rounded-lg focus:ring-primary-500 focus:border-primary-500"
              placeholder="e.g., Software Engineer, Full Stack Developer..."
            />
            <button
              type="button"
              onClick={addRole}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition sm:w-auto"
            >
              Add
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {formData.preferredRoles.map((role, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm"
              >
                {role}
                <button
                  type="button"
                  onClick={() => removeRole(role)}
                  className="hover:text-green-900"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isSaving}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-6 py-3 font-medium text-white transition hover:bg-primary-700 disabled:opacity-50 sm:w-auto"
        >
          {isSaving ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-5 w-5" />
              Save Profile
            </>
          )}
        </button>
      </form>
    </div>
  );
}
