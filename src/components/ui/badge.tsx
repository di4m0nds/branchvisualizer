import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive' | 'git';
  /** Optional dot indicator */
  dot?: boolean;
}

const variants: Record<NonNullable<BadgeProps['variant']>, string> = {
  default:     'bg-primary/15 text-primary border-primary/25',
  secondary:   'bg-surface-2 text-muted-fg border-border',
  outline:     'bg-transparent text-muted-fg border-border',
  success:     'bg-success/10 text-success border-success/25',
  warning:     'bg-warning/10 text-warning border-warning/25',
  destructive: 'bg-destructive/10 text-destructive border-destructive/25',
  git:         'bg-surface-2 text-foreground border-border font-mono',
};

export function Badge({ className, variant = 'secondary', dot, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 border text-xs font-medium px-2 py-0.5 rounded-full',
        'leading-tight whitespace-nowrap',
        variants[variant],
        className,
      )}
      {...props}
    >
      {dot && (
        <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
      )}
      {children}
    </span>
  );
}
