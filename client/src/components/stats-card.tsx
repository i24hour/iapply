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
    <div className={cn('rounded-xl border p-6', colorClasses[color])}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{title}</p>
          <p className="text-3xl font-bold mt-1">{value}</p>
        </div>
        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-sm">
          {icon}
        </div>
      </div>
    </div>
  );
}
