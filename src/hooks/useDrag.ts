import { useState, useRef, useCallback } from 'react';

interface Position {
  x: number;
  y: number;
}

/**
 * Drag logic for floating panels: tracks a fixed position and exposes a
 * mousedown handler for the drag handle. Window mousemove/mouseup listeners
 * are attached on drag start and removed on drag end.
 */
export function useDrag(initial: Position) {
  const [pos, setPos] = useState<Position>(initial);

  const isDraggingPanel = useRef(false);
  const dragOrigin = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 });

  const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    e.preventDefault();
    isDraggingPanel.current = true;
    dragOrigin.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panelX: pos.x,
      panelY: pos.y,
    };

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingPanel.current) return;
      setPos({
        x: dragOrigin.current.panelX + (ev.clientX - dragOrigin.current.mouseX),
        y: dragOrigin.current.panelY + (ev.clientY - dragOrigin.current.mouseY),
      });
    };

    const onMouseUp = () => {
      isDraggingPanel.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [pos]);

  return { pos, setPos, onHandleMouseDown };
}
