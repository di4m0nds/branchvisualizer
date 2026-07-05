// Themed numeric input — replaces native <input type="number"> (OS spinners
// clash with the dark theme). Free-typing is allowed; the value is clamped to
// [min, max] on blur. Callers keep the controlled-string contract native
// inputs had.

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface NumberInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  error?: boolean;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  ({ className, value, onChange, min, max, error, onBlur, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          // Digits, one decimal point, optional leading minus (when min < 0).
          if (/^-?\d*\.?\d*$/.test(v)) onChange(v);
        }}
        onBlur={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) {
            let clamped = n;
            if (min != null && clamped < min) clamped = min;
            if (max != null && clamped > max) clamped = max;
            if (clamped !== n) onChange(String(clamped));
          }
          onBlur?.(e);
        }}
        className={cn(
          'h-8 rounded-md border border-border bg-muted/30 px-2 text-[11px] text-foreground',
          'placeholder:text-muted-foreground/50 transition-colors',
          'focus:outline-none focus:border-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-destructive/60',
          className,
        )}
        {...props}
      />
    );
  },
);
NumberInput.displayName = 'NumberInput';
