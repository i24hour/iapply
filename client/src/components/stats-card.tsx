import { cn } from '@/lib/utils';

interface StatsCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: 'green' | 'blue' | 'red' | 'yellow';
}

const colorClasses = {
  green: 'bg-green-500/10 border-green-500/20',
  blue: 'bg-blue-500/10 border-blue-500/20',
  red: 'bg-red-500/10 border-red-500/20',
  yellow: 'bg-yellow-500/10 border-yellow-500/20',
};

export function StatsCard({ title, value, icon, color }: StatsCardProps) {
  return (
    <div className={cn('rounded-xl border p-4 shadow-sm', colorClasses[color])}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{value}</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background/50 backdrop-blur-sm border border-border/50">
          {icon}
        </div>
      </div>
    </div>
  );
}
