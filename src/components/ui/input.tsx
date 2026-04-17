import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, leftIcon, rightIcon, error, ...props }, ref) => {
    if (leftIcon || rightIcon) {
      return (
        <div className={cn('relative flex items-center', className)}>
          {leftIcon && (
            <span className="absolute left-3 text-muted-fg pointer-events-none flex items-center">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            className={cn(
              'flex h-9 w-full rounded-md border bg-surface-2 px-3 py-2 text-sm text-foreground',
              'placeholder:text-muted-fg/60',
              'transition-colors duration-150',
              'focus:outline-none focus:ring-2 focus:ring-primary/35 focus:border-primary/60',
              'disabled:cursor-not-allowed disabled:opacity-50',
              leftIcon  && 'pl-9',
              rightIcon && 'pr-9',
              error && 'border-destructive/60 focus:ring-destructive/30',
            )}
            {...props}
          />
          {rightIcon && (
            <span className="absolute right-3 flex items-center">
              {rightIcon}
            </span>
          )}
        </div>
      );
    }

    return (
      <input
        ref={ref}
        className={cn(
          'flex h-9 w-full rounded-md border bg-surface-2 px-3 py-2 text-sm text-foreground',
          'placeholder:text-muted-fg/60',
          'transition-colors duration-150',
          'focus:outline-none focus:ring-2 focus:ring-primary/35 focus:border-primary/60',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-destructive/60 focus:ring-destructive/30',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
