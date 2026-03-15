'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { authApi } from '@/lib/api';
import {
  buildExtensionRedirectUrl,
  isExtensionReturnTo,
  rememberExtensionReturnTo,
} from '@/lib/extension-auth';
import toast from 'react-hot-toast';
import { Briefcase, Loader2 } from 'lucide-react';

export default function SignupPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [telegramId, setTelegramId] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const loginHref = (() => {
    const params = new URLSearchParams();
    if (telegramId) params.set('telegram_id', telegramId);
    if (returnTo) params.set('return_to', returnTo);
    const query = params.toString();
    return query ? `/login?${query}` : '/login';
  })();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setTelegramId(params.get('telegram_id'));
    const nextReturnTo = params.get('return_to');
    const safeReturnTo = isExtensionReturnTo(nextReturnTo) ? nextReturnTo : null;
    setReturnTo(safeReturnTo);
    rememberExtensionReturnTo(safeReturnTo);

    const token = localStorage.getItem('auth_token');
    if (safeReturnTo && token) {
      window.location.replace(buildExtensionRedirectUrl(safeReturnTo, token));
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (formData.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);

    try {
      const response = await authApi.signup(formData.fullName, formData.email, formData.password);
      setAuth(response.data.user, response.data.token);
      if (telegramId) {
        const linkRes = await authApi.linkTelegram(telegramId);
        toast.success('Telegram verified successfully!');
        router.replace(`/auth/success?from=telegram&bot=${encodeURIComponent(linkRes.data.botUsername)}`);
      } else if (returnTo) {
        window.location.replace(buildExtensionRedirectUrl(returnTo, response.data.token));
      } else {
        toast.success('Account created successfully!');
        router.replace('/dashboard');
      }
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to create account');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2 mb-6">
            <Briefcase className="h-10 w-10 text-primary-600" />
            <span className="text-2xl font-bold">JobAuto</span>
          </Link>
          <h2 className="text-3xl font-bold text-gray-900">Create your account</h2>
          <p className="mt-2 text-gray-600">
            Already have an account?{' '}
            <Link
              href={loginHref}
              className="text-primary-600 hover:text-primary-500"
            >
              Sign in
            </Link>
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-gray-700">
                Full Name
              </label>
              <input
                id="fullName"
                name="fullName"
                type="text"
                autoComplete="name"
                required
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500"
                placeholder="John Doe"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500"
                placeholder="••••••••"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                className="mt-1 block w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-primary-500 focus:border-primary-500"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white px-4 py-3 rounded-lg font-semibold hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Creating account...
              </>
            ) : (
              'Create account'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
