import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: 'green' | 'blue' | 'red' | 'yellow';
}

const colorClasses = {
  green: 'bg-green-50 border-green-200',
  blue: 'bg-blue-50 border-blue-200',
  red: 'bg-red-50 border-red-200',
  yellow: 'bg-yellow-50 border-yellow-200',
};

export function StatsCard({ title, value, icon, color }: StatsCardProps) {
  return (
    <div className={cn('rounded-xl border p-4 sm:p-6', colorClasses[color])}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{title}</p>
          <p className="mt-1 text-2xl font-bold sm:text-3xl">{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm sm:h-12 sm:w-12">
          {icon}
        </div>
      </div>
    </div>
  );
}
