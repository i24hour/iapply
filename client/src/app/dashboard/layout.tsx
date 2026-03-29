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

import { RightSidebar } from '@/components/right-sidebar';
import { ThemeSwitcher } from '@/components/theme-switcher';

// ... (keep navigation config) ...

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
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="rounded-xl border border-border bg-surface px-6 py-4 text-sm text-muted-foreground shadow-sm">
          Loading dashboard...
        </div>
      </div>
    );
  }

  const SidebarContent = () => (
    <div className="flex h-full flex-col justify-between overflow-y-auto">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3 px-4 py-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
            <Briefcase className="h-6 w-6 text-primary-foreground" />
          </div>
          <span className="text-2xl font-bold tracking-tight">JobAuto</span>
        </div>

        <nav className="space-y-1 px-2">
          {navigation.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-4 rounded-full px-4 py-3 text-lg transition',
                  isActive 
                    ? 'font-bold text-foreground bg-muted' 
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                <item.icon className="h-6 w-6" strokeWidth={isActive ? 2.5 : 2} />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="space-y-2 p-4">
        <ThemeSwitcher />
        
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-full px-4 py-3 text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <LogOut className="h-6 w-6" />
          <span className="font-medium">Sign out</span>
        </button>

        <div className="mt-2 flex items-center gap-3 rounded-full px-4 py-3 hover:bg-muted transition cursor-pointer">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20">
            <User className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="truncate text-sm font-bold text-foreground">{user?.email}</p>
            <p className="truncate text-xs text-muted-foreground">Free Plan</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground flex justify-center">
      {/* Mobile Header */}
      <header className="fixed top-0 z-30 w-full border-b border-border bg-background/95 backdrop-blur xl:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <Briefcase className="h-7 w-7 text-primary" />
            <span className="text-xl font-bold">JobAuto</span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileNavOpen((open) => !open)}
            className="rounded-full p-2 text-foreground transition hover:bg-muted"
          >
            {mobileNavOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </header>

      {/* Mobile Sidebar Overlay */}
      {mobileNavOpen && (
        <>
          <div
            onClick={() => setMobileNavOpen(false)}
            className="fixed inset-0 z-40 bg-black/40 xl:hidden"
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 border-r border-border bg-background shadow-xl xl:hidden">
            <SidebarContent />
          </aside>
        </>
      )}

      {/* Desktop Left Sidebar */}
      <header className="hidden xl:flex flex-col w-[275px] h-screen sticky top-0 items-end border-r border-border">
        <div className="w-full h-full max-w-[275px]">
          <SidebarContent />
        </div>
      </header>

      {/* Main Container */}
      <main className="flex w-full max-w-[1050px] min-h-screen pt-14 xl:pt-0">
        {/* Center Feed */}
        <div className="flex-1 max-w-[600px] border-r border-border min-h-screen">
          {children}
        </div>

        {/* Right Sidebar */}
        <aside className="hidden lg:block w-[350px] shrink-0 p-6 sticky top-0 h-screen overflow-y-auto">
          <RightSidebar />
        </aside>
      </main>
    </div>
  );
}
