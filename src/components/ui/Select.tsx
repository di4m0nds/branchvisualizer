// Styled wrapper over radix Select — replaces native <select> elements so
// dropdowns match the app theme everywhere (native selects render OS chrome).
// The listbox renders through a portal, so it is immune to overflow clipping
// and CSS-zoomed ancestors.

import * as React from 'react';
import { Select as RS } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

function Select({ ...props }: React.ComponentProps<typeof RS.Root>) {
  return <RS.Root data-slot="select" {...props} />;
}

function SelectValue({ ...props }: React.ComponentProps<typeof RS.Value>) {
  return <RS.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RS.Trigger>) {
  return (
    <RS.Trigger
      data-slot="select-trigger"
      className={cn(
        'inline-flex h-8 items-center justify-between gap-1.5 rounded-md border border-border',
        'bg-muted/30 px-2 text-[11px] text-foreground whitespace-nowrap',
        'focus:outline-none focus:border-ring transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      <RS.Icon asChild>
        <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
      </RS.Icon>
    </RS.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: React.ComponentProps<typeof RS.Content>) {
  return (
    <RS.Portal>
      <RS.Content
        data-slot="select-content"
        position={position}
        sideOffset={4}
        className={cn(
          'z-[100] max-h-[min(var(--radix-select-content-available-height),320px)] min-w-[var(--radix-select-trigger-width)]',
          'overflow-y-auto rounded-md border border-border bg-popover shadow-lg py-1',
          className,
        )}
        {...props}
      >
        <RS.Viewport>{children}</RS.Viewport>
      </RS.Content>
    </RS.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof RS.Item>) {
  return (
    <RS.Item
      data-slot="select-item"
      className={cn(
        'relative flex items-center gap-2 pl-2.5 pr-7 py-1.5 text-[11px] text-foreground',
        'cursor-pointer select-none outline-none',
        'hover:bg-accent/40 data-[highlighted]:bg-accent/40',
        'data-[disabled]:opacity-50 data-[disabled]:pointer-events-none',
        className,
      )}
      {...props}
    >
      <RS.ItemText>{children}</RS.ItemText>
      <RS.ItemIndicator className="absolute right-2 flex items-center">
        <Check className="w-3 h-3 text-primary" />
      </RS.ItemIndicator>
    </RS.Item>
  );
}

function SelectGroup({ ...props }: React.ComponentProps<typeof RS.Group>) {
  return <RS.Group data-slot="select-group" {...props} />;
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof RS.Label>) {
  return (
    <RS.Label
      data-slot="select-label"
      className={cn('px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground', className)}
      {...props}
    />
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof RS.Separator>) {
  return (
    <RS.Separator
      data-slot="select-separator"
      className={cn('my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

export {
  Select,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
};
