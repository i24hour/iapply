'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api';
import { Briefcase, Loader2 } from 'lucide-react';

export default function AuthSuccessPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();

  useEffect(() => {
    const handleAuthSuccess = async () => {
      // Token comes in the URL hash: /auth/success#token=xxx
      const hash = window.location.hash;
      const params = new URLSearchParams(hash.replace('#', ''));
      const token = params.get('token');

      if (!token) {
        router.replace('/login');
        return;
      }

      // Store token in localStorage so api interceptor picks it up
      localStorage.setItem('auth_token', token);

      try {
        // Fetch user info
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
        router.replace('/dashboard');
      } catch {
        localStorage.removeItem('auth_token');
        router.replace('/login');
      }
    };

    handleAuthSuccess();
  }, []);

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
