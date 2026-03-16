'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import {
  buildExtensionRedirectUrl,
  clearPendingExtensionReturnTo,
  getPendingExtensionReturnTo,
} from '@/lib/extension-auth';
import {
  BarChart3,
  Briefcase,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  User,
  X,
} from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Profile', href: '/dashboard/profile', icon: User },
  { name: 'Resume', href: '/dashboard/resume', icon: FileText },
  { name: 'Preferences', href: '/dashboard/preferences', icon: Settings },
  { name: 'Applications', href: '/dashboard/applications', icon: ClipboardList },
  { name: 'Usage', href: '/dashboard/usage', icon: BarChart3 },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, logout } = useAuthStore();
  const [hydrated, setHydrated] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.push('/login');
    }
  }, [hydrated, isAuthenticated, router]);

  useEffect(() => {
    if (!hydrated || !isAuthenticated || typeof window === 'undefined') return;

    const pendingExtensionReturnTo = getPendingExtensionReturnTo();
    const token = localStorage.getItem('auth_token');

    if (!pendingExtensionReturnTo || !token) return;

    clearPendingExtensionReturnTo();
    window.location.replace(buildExtensionRedirectUrl(pendingExtensionReturnTo, token));
  }, [hydrated, isAuthenticated]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  if (!hydrated || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6">
        <div className="rounded-xl border bg-white px-6 py-4 text-sm text-gray-600 shadow-sm">
          Loading dashboard...
        </div>
      </div>
    );
  }

  const SidebarContent = () => (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-5 py-4 sm:px-6">
        <Briefcase className="h-8 w-8 text-primary-600" />
        <span className="text-xl font-bold">JobAuto</span>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-5 sm:px-4 sm:py-6">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-4 py-3 transition',
                isActive ? 'bg-primary-50 text-primary-600' : 'text-gray-600 hover:bg-gray-50'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-4">
        <div className="flex items-center gap-3 px-3 py-2 sm:px-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100">
            <User className="h-5 w-5 text-primary-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-3 text-gray-600 transition hover:bg-gray-50 sm:px-4"
        >
          <LogOut className="h-5 w-5" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Briefcase className="h-7 w-7 text-primary-600" />
            <span className="text-lg font-bold">JobAuto</span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileNavOpen((open) => !open)}
            className="rounded-lg border border-gray-200 p-2 text-gray-600 transition hover:bg-gray-50"
            aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
          >
            {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {mobileNavOpen && (
        <>
          <button
            type="button"
            aria-label="Close navigation overlay"
            onClick={() => setMobileNavOpen(false)}
            className="fixed inset-0 z-40 bg-gray-900/40 md:hidden"
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r bg-white shadow-xl md:hidden">
            <SidebarContent />
          </aside>
        </>
      )}

      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-white md:block">
        <SidebarContent />
      </aside>

      <main className="px-4 py-4 sm:px-6 sm:py-6 md:ml-64 md:p-8">{children}</main>
    </div>
  );
}
