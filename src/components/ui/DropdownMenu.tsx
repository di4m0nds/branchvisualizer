// Styled wrapper over radix DropdownMenu. Content renders through a portal so
// menus opened from inside overflow-clipped scrollers (e.g. the sidebar list)
// or opacity-reduced rows are never clipped or dimmed.

import * as React from 'react';
import { DropdownMenu as RD } from 'radix-ui';
import { cn } from '@/lib/utils';

function DropdownMenu({ ...props }: React.ComponentProps<typeof RD.Root>) {
  return <RD.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof RD.Trigger>) {
  return <RD.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  align = 'end',
  ...props
}: React.ComponentProps<typeof RD.Content>) {
  return (
    <RD.Portal>
      <RD.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        align={align}
        className={cn(
          'z-[100] min-w-36 rounded-md border border-border bg-popover shadow-lg',
          'text-xs text-popover-foreground overflow-hidden py-0.5',
          className,
        )}
        {...props}
      />
    </RD.Portal>
  );
}

function DropdownMenuItem({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof RD.Item> & { variant?: 'default' | 'destructive' }) {
  return (
    <RD.Item
      data-slot="dropdown-menu-item"
      className={cn(
        'w-full flex items-center gap-2 px-2.5 py-1.5 text-left cursor-pointer select-none outline-none',
        variant === 'destructive'
          ? 'text-destructive hover:bg-destructive/20 data-[highlighted]:bg-destructive/20'
          : 'text-foreground hover:bg-accent/40 data-[highlighted]:bg-accent/40',
        className,
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof RD.Separator>) {
  return (
    <RD.Separator
      data-slot="dropdown-menu-separator"
      className={cn('my-0.5 h-px bg-border', className)}
      {...props}
    />
  );
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof RD.Label>) {
  return (
    <RD.Label
      data-slot="dropdown-menu-label"
      className={cn('px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
};
