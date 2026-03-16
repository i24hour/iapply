'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import {
  buildExtensionRedirectUrl,
  clearPendingExtensionReturnTo,
  getPendingExtensionReturnTo,
} from '@/lib/extension-auth';

export default function HomePage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hash = window.location.hash;
    const hasAuthToken = hash.includes('access_token=') || hash.includes('token=');
    const pendingExtensionReturnTo = getPendingExtensionReturnTo();
    const storedToken = localStorage.getItem('auth_token');

    // Extension auth redirect
    if (pendingExtensionReturnTo && storedToken && !hasAuthToken) {
      clearPendingExtensionReturnTo();
      window.location.replace(buildExtensionRedirectUrl(pendingExtensionReturnTo, storedToken));
      return;
    }

    // OAuth callback with token in hash → hand off to auth/success
    if (hasAuthToken) {
      const telegramContextRaw = sessionStorage.getItem('telegram_auth_context');
      const search = telegramContextRaw ? '?from=telegram' : '';
      router.replace(`/auth/success${search}${hash}`);
      return;
    }

    // Normal visit: send to dashboard or login
    router.replace(isAuthenticated ? '/dashboard' : '/login');
  }, [router, isAuthenticated]);

  return null;
}
