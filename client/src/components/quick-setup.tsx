import Link from 'next/link';
import { FileText, User, ArrowRight } from 'lucide-react';

interface QuickSetupProps {
  hasResume: boolean;
  hasProfile: boolean;
}

export function QuickSetup({ hasResume, hasProfile }: QuickSetupProps) {
  const steps = [
    {
      name: 'Upload Resume',
      description: 'Upload your resume to extract skills and experience',
      href: '/dashboard/resume',
      icon: FileText,
      completed: hasResume,
    },
    {
      name: 'Complete Profile',
      description: 'Add your contact info and preferences',
      href: '/dashboard/profile',
      icon: User,
      completed: hasProfile,
    },
  ];

  const allCompleted = hasResume && hasProfile;

  if (allCompleted) return null;

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 sm:p-5">
      <h2 className="text-lg font-bold text-foreground mb-1">
        Complete Your Setup
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Finish these steps to start automating your job applications.
      </p>

      <div className="space-y-3">
        {steps.map((step) => (
          <Link
            key={step.name}
            href={step.href}
            className={`group flex flex-col items-start gap-4 rounded-xl p-4 transition sm:flex-row sm:items-center sm:justify-between ${
              step.completed
                ? 'bg-green-500/10 border border-green-500/20'
                : 'bg-surface border border-primary/20 hover:border-primary/50'
            }`}
          >
            <div className="flex items-start gap-4">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  step.completed
                    ? 'bg-green-500/20 text-green-600 dark:text-green-500'
                    : 'bg-primary/20 text-primary'
                }`}
              >
                <step.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-bold text-foreground">{step.name}</p>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </div>
            </div>
            {step.completed ? (
              <span className="text-green-600 dark:text-green-500 text-sm font-bold bg-green-500/10 px-3 py-1 rounded-full">Complete</span>
            ) : (
              <ArrowRight className="h-5 w-5 text-primary self-end sm:self-auto transition group-hover:translate-x-1" />
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
