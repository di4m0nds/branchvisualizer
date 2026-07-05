// Full-screen image viewer for chat attachments. Portals to <body> (immune to
// panel zoom/overflow), supports prev/next across a set of images via chevrons
// or Arrow keys; Escape closes.

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface LightboxImage {
  src: string;
  name: string;
}

export default function ImageLightbox({ images, index, onClose }: {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(index);
  const count = images.length;

  const step = useCallback((delta: number) => {
    setCurrent((c) => (c + delta + count) % count);
  }, [count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowLeft' && count > 1) { e.preventDefault(); step(-1); }
      else if (e.key === 'ArrowRight' && count > 1) { e.preventDefault(); step(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count, step, onClose]);

  const img = images[current];
  if (!img) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] bg-black/85 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="Close preview"
      >
        <X className="w-5 h-5" />
      </button>

      {count > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); step(-1); }}
          className="absolute left-3 p-2.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Previous image"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      <figure
        className="max-w-[90vw] max-h-[90vh] flex flex-col items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={img.src}
          alt={img.name}
          className="max-w-[90vw] max-h-[82vh] object-contain rounded-md shadow-2xl select-none"
          draggable={false}
        />
        <figcaption className="flex items-center gap-2 text-[11px] text-white/70 font-mono">
          <span className="truncate max-w-[60vw]">{img.name}</span>
          {count > 1 && <span className="tabular-nums">{current + 1} / {count}</span>}
        </figcaption>
      </figure>

      {count > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); step(1); }}
          className={cn('absolute right-3 p-2.5 rounded-full text-white/70 hover:text-white hover:bg-white/10 transition-colors')}
          aria-label="Next image"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}
    </div>,
    document.body,
  );
}
