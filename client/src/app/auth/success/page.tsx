'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api';
import {
  buildExtensionRedirectUrl,
  clearPendingExtensionReturnTo,
  getPendingExtensionReturnTo,
  isExtensionReturnTo,
} from '@/lib/extension-auth';
import Link from 'next/link';
import { ArrowRight, Briefcase, CheckCircle2, Loader2 } from 'lucide-react';

type ViewState = 'loading' | 'telegram-success' | 'error';

export default function AuthSuccessPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [botUsername, setBotUsername] = useState('infiniteapplybot');
  const safeBot = botUsername.replace('@', '');
  const botLinks = {
    tgDeepLink: `tg://resolve?domain=${safeBot}&start=success`,
    webBotLink: `https://t.me/${safeBot}?start=success`,
  };

  const handleReturnToBot = () => {
    window.location.href = botLinks.tgDeepLink;
    window.setTimeout(() => {
      window.location.href = botLinks.webBotLink;
    }, 900);
  };

  useEffect(() => {
    const handleAuthSuccess = async () => {
      const searchParams = new URLSearchParams(window.location.search);
      const hash = window.location.hash;
      const hashParams = new URLSearchParams(hash.replace('#', ''));
      const telegramContextRaw = sessionStorage.getItem('telegram_auth_context');
      const telegramContext = telegramContextRaw ? JSON.parse(telegramContextRaw) as { telegramId?: string } : null;
      const fromTelegram = searchParams.get('from') === 'telegram' || !!telegramContext?.telegramId;
      const rawReturnTo = searchParams.get('return_to');
      const returnTo = isExtensionReturnTo(rawReturnTo) ? rawReturnTo : getPendingExtensionReturnTo();
      const bot = searchParams.get('bot');
      const resolvedBotUsername = (bot || 'infiniteapplybot').replace('@', '');
      if (bot) {
        setBotUsername(resolvedBotUsername);
      }

      const token =
        hashParams.get('access_token') ||
        searchParams.get('access_token') ||
        hashParams.get('token') ||
        searchParams.get('token') ||
        localStorage.getItem('auth_token');

      if (!token) {
        setErrorMessage('Missing authentication token. Please try signing in again.');
        setViewState('error');
        return;
      }

      localStorage.setItem('auth_token', token);

      try {
        const res = await api.get('/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const userData = res.data;
        setAuth(
          {
            id: userData.id,
            email: userData.email,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          token
        );
        if (returnTo) {
          const refreshToken = hashParams.get('refresh_token') || searchParams.get('refresh_token');
          clearPendingExtensionReturnTo();
          window.location.replace(buildExtensionRedirectUrl(returnTo, token, refreshToken));
          return;
        }
        if (fromTelegram) {
          sessionStorage.removeItem('telegram_auth_context');
          setViewState('telegram-success');
          return;
        }

        router.replace('/dashboard');
      } catch (error) {
        console.error('Failed to complete auth success flow:', error);
        localStorage.removeItem('auth_token');
        setErrorMessage('We could not complete verification. Please try again.');
        setViewState('error');
      }
    };

    handleAuthSuccess();
  }, [router, setAuth]);

  if (viewState === 'telegram-success') {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-10 sm:px-6">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-lg items-center justify-center">
          <div className="w-full rounded-2xl border bg-white p-6 text-center shadow-sm sm:p-8">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
              <CheckCircle2 className="h-7 w-7 text-green-600" />
            </div>
            <div className="mb-3 flex items-center justify-center gap-2">
              <Briefcase className="h-7 w-7 text-primary-600" />
              <span className="text-xl font-bold text-gray-900">JobAuto</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Verification complete</h1>
            <p className="mt-3 text-sm leading-6 text-gray-600 sm:text-base">
              Your account is now linked with Telegram. Tap the button below to go back to the bot.
            </p>

            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={handleReturnToBot}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 py-3 font-semibold text-white transition hover:bg-primary-700"
              >
                Go back to Bot
                <ArrowRight className="h-4 w-4" />
              </button>
              <Link
                href="/dashboard"
                className="inline-flex w-full items-center justify-center rounded-xl border border-gray-200 px-5 py-3 font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Open Dashboard
              </Link>
            </div>

            <p className="mt-4 text-xs text-gray-500">
              The button first tries the Telegram app, then falls back to the bot link.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (viewState === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 text-center">
        <div className="mb-6 flex items-center gap-3">
          <Briefcase className="h-10 w-10 text-primary-600" />
          <span className="text-2xl font-bold">JobAuto</span>
        </div>
        <p className="max-w-md text-gray-600">{errorMessage}</p>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-3 font-semibold text-white hover:bg-primary-700"
        >
          Back to login
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <div className="flex items-center gap-3 mb-6">
        <Briefcase className="h-10 w-10 text-primary-600" />
        <span className="text-2xl font-bold">JobAuto</span>
      </div>
      <div className="flex items-center gap-3 text-gray-600">
        <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
        <span className="text-lg">Signing you in...</span>
      </div>
    </div>
  );
}
