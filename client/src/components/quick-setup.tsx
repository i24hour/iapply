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
    <div className="rounded-xl border border-primary-200 bg-primary-50 p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-primary-900 mb-2">
        Complete Your Setup
      </h2>
      <p className="text-primary-700 mb-4">
        Finish these steps to start automating your job applications.
      </p>

      <div className="space-y-3">
        {steps.map((step) => (
          <Link
            key={step.name}
            href={step.href}
            className={`flex flex-col items-start gap-3 rounded-lg p-4 transition sm:flex-row sm:items-center sm:justify-between ${
              step.completed
                ? 'bg-green-50 border border-green-200'
                : 'bg-white border border-primary-200 hover:border-primary-400'
            }`}
          >
            <div className="flex items-start gap-4">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  step.completed
                    ? 'bg-green-100 text-green-600'
                    : 'bg-primary-100 text-primary-600'
                }`}
              >
                <step.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="font-medium text-gray-900">{step.name}</p>
                <p className="text-sm text-gray-600">{step.description}</p>
              </div>
            </div>
            {step.completed ? (
              <span className="text-green-600 text-sm font-medium">Complete</span>
            ) : (
              <ArrowRight className="h-5 w-5 text-primary-600 self-end sm:self-auto" />
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
