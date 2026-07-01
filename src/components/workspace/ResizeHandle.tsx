import { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface ResizeHandleProps {
  direction: 'h' | 'v'; // h = left|right drag, v = top|bottom drag
  containerRef: React.RefObject<HTMLDivElement | null>;
  size: number; // current first-pane percentage
  onSizeChange: (newSize: number) => void;
  /** Clamp bounds for the first pane percentage. */
  min?: number;
  max?: number;
}

/**
 * Draggable divider that reports the first pane's size as a percentage of the
 * container. Extracted from TabWorkspace so both the split-pane grid and the IDE
 * shell (session rail / terminal dock / chat rail) share one implementation.
 */
export function ResizeHandle({
  direction,
  containerRef,
  size,
  onSizeChange,
  min = 20,
  max = 80,
}: ResizeHandleProps) {
  const isDragging = useRef(false);
  const startPosRef = useRef(0);
  const startSizeRef = useRef(size);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startPosRef.current = direction === 'h' ? e.clientX : e.clientY;
    startSizeRef.current = size;

    const onMouseMove = (me: MouseEvent) => {
      if (!isDragging.current) return;
      const container = containerRef.current;
      if (!container) return;
      const containerSize = direction === 'h' ? container.offsetWidth : container.offsetHeight;
      const delta = (direction === 'h' ? me.clientX : me.clientY) - startPosRef.current;
      const newSize = Math.min(max, Math.max(min, startSizeRef.current + (delta / containerSize) * 100));
      onSizeChange(newSize);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [direction, containerRef, size, onSizeChange, min, max]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className={cn(
        'flex-shrink-0 group relative flex items-center justify-center',
        'bg-border/50 hover:bg-primary/40 active:bg-primary/60 transition-colors z-10',
        direction === 'h'
          ? 'w-1 cursor-col-resize hover:w-1.5 active:w-1.5'
          : 'h-1 cursor-row-resize hover:h-1.5 active:h-1.5',
      )}
      title="Drag to resize"
    >
      {/* Grab dots */}
      <div className={cn(
        'flex gap-0.5 opacity-0 group-hover:opacity-60 transition-opacity',
        direction === 'h' ? 'flex-col' : 'flex-row',
      )}>
        {[0, 1, 2].map(i => (
          <div key={i} className="w-1 h-1 rounded-full bg-foreground" />
        ))}
      </div>
    </div>
  );
}

export default ResizeHandle;
