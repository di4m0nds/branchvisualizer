// ─── Attached-plan dock ─────────────────────────────────────────────────────
// Shows the session's latest plan as a collapsible summary rendered via the
// same PlanSectionCard primitive PlanView uses, so both surfaces read
// identically and share the same comment slice. Two presentations:
//   • default        → a slim strip pinned under the chat header, collapsing
//                       vertically from the top.
//   • maximized/focus → a panel docked on the RIGHT edge of the chat, floating
//                       over the wide side margin so the centered message
//                       column stays centered. Collapses to a thin vertical
//                       rail; expands leftward.
// "Open in Plan view →" swaps the right column via the useSetRightView bus.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { nextId, type PlanComment, type Session } from '@/types/session';
import { latestPlanText, parsePlanSections, type PlanSection } from '@/lib/agent/plan';
import { setRightView } from '@/hooks/useSetRightView';
import { useAppDispatch } from '@/store/store';
import PlanSectionCard from '@/components/ide/plan/PlanSectionCard';

// Per-session open/closed state, persisted so revisiting a session doesn't
// force the dock back open (or back closed) against the user's last choice.
const OPEN_KEY = (sessionId: string) => `code-agent:attached_plan_open:${sessionId}`;

function loadOpen(sessionId: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(OPEN_KEY(sessionId));
    if (raw === null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}

function saveOpen(sessionId: string, open: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(OPEN_KEY(sessionId), open ? '1' : '0');
  } catch { /* quota / private mode */ }
}

// Focus-view right-dock width — per-session, drag-resizable. Clamp range keeps
// the dock usable (readable at min, doesn't crowd the message column at max);
// max fits well within the chat panel in any split layout.
const WIDTH_KEY = (sessionId: string) => `code-agent:attached_plan_width:${sessionId}`;
const DEFAULT_WIDTH = 288;
const MIN_WIDTH = 220;
const MAX_WIDTH = 560;

function clampWidth(w: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(w)));
}

function loadWidth(sessionId: string): number {
  if (typeof localStorage === 'undefined') return DEFAULT_WIDTH;
  try {
    const raw = localStorage.getItem(WIDTH_KEY(sessionId));
    if (raw === null) return DEFAULT_WIDTH;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? clampWidth(n) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(sessionId: string, w: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(WIDTH_KEY(sessionId), String(clampWidth(w)));
  } catch { /* quota / private mode */ }
}

export default function AttachedPlanStrip({ session, maximized = false }: { session: Session; maximized?: boolean }) {
  const dispatch = useAppDispatch();
  const source = latestPlanText(session);
  // Default closed — the dock should hint the plan exists without eating
  // space. User's per-session choice wins after the first toggle.
  const [open, setOpenState] = useState(() => loadOpen(session.id, false));
  useEffect(() => {
    setOpenState(loadOpen(session.id, false));
  }, [session.id]);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    saveOpen(session.id, next);
  };

  // Focus-view dock width — persisted per session. `dragging` gates the
  // framer-motion transition so pointer moves apply immediately instead of
  // easing every frame. Only relevant to the maximized branch below.
  const [width, setWidth] = useState(() => loadWidth(session.id));
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    setWidth(loadWidth(session.id));
  }, [session.id]);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    setDragging(true);
    let pending: number | null = null;
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (pending != null) { setWidth(pending); pending = null; }
    };
    const onMove = (me: MouseEvent) => {
      // Dragging LEFT widens a right-docked panel — subtract the delta.
      pending = clampWidth(startWidth - (me.clientX - startX));
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onUp = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (pending != null) { setWidth(pending); pending = null; }
      setDragging(false);
      // Read the freshest width off state after flush — closure `pending` was
      // consumed. Use a ref-free read via the setter's callback form.
      setWidth((w) => { saveWidth(session.id, w); return w; });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [width, session.id]);

  // Parse sections lazily. `source.text`/`source.messageId` cover every
  // visible-content change; the `source` object identity churns every render.
  const sourceText = source?.text ?? '';
  const sourceMessageId = source?.messageId ?? '';
  const sections = useMemo(
    () => (sourceText ? parsePlanSections(sourceText, sourceMessageId) : []),
    [sourceText, sourceMessageId],
  );

  if (!source) return null;

  const summaryTitle =
    sections.find((s) => s.heading)?.heading
    ?? source.text.split('\n').map((l) => l.trim()).find(Boolean)
    ?? 'Implementation plan';
  const stepCount = sections.filter((s) => s.heading && s.level >= 2).length;

  const openInSidePanel = () => {
    if (!setRightView('plan')) setOpen(true);
  };

  // Shared section list — identical in both presentations; comments dispatch to
  // the same session slice as the side panel, so all surfaces stay in sync.
  const renderSection = (section: PlanSection) => (
    <PlanSectionCard
      key={section.id}
      section={section}
      comments={(session.planComments ?? []).filter((c) => c.sectionId === section.id)}
      selected={false}
      onSelect={() => {}}
      onAddComment={(text) => {
        const comment: PlanComment = {
          id: nextId('plancomment'),
          messageId: source.messageId,
          sectionId: section.id,
          sectionHeading: section.heading,
          text,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: 'ADD_PLAN_COMMENT', sessionId: session.id, comment });
      }}
      onRemoveComment={(id) =>
        dispatch({ type: 'REMOVE_PLAN_COMMENT', sessionId: session.id, commentId: id })
      }
      onResolveComment={(id) => {
        const c = (session.planComments ?? []).find((x) => x.id === id);
        dispatch({
          type: 'UPDATE_PLAN_COMMENT',
          sessionId: session.id,
          commentId: id,
          patch: { resolved: !c?.resolved },
        });
      }}
    />
  );
  const sectionList = sections.length === 0
    ? <p className="text-[11px] text-muted-foreground/70 italic">Plan is empty.</p>
    : sections.map(renderSection);

  // ── Focus view: right-docked panel, floating over the side margin ──────────
  if (maximized) {
    return (
      <motion.div
        initial={false}
        animate={{ width: open ? width : 36 }}
        // Disable the ease while dragging so the width tracks the pointer 1:1
        // instead of easing every frame (fighting the drag).
        transition={dragging ? { duration: 0 } : { duration: 0.16, ease: 'easeOut' }}
        className={cn(
          'absolute right-0 top-0 bottom-0 z-20 flex-shrink-0 overflow-hidden',
          'border-l bg-background/90 backdrop-blur-sm',
          source.pending ? 'border-amber-500/25' : 'border-primary/25',
        )}
      >
        {open ? (
          <div className="h-full flex flex-col" style={{ width }}>
            {/* Left-edge drag handle — resizes the docked panel. Dragging LEFT
                widens (right-anchored panel). Only present while open. */}
            <div
              onMouseDown={startResize}
              title="Drag to resize"
              className={cn(
                'absolute left-0 top-0 bottom-0 w-1 cursor-col-resize z-30 transition-colors',
                dragging ? 'bg-primary/60' : 'bg-border/40 hover:bg-primary/40',
              )}
            />
            <div className="flex items-center gap-2 px-3 h-8 border-b border-border/40 flex-shrink-0">
              <ClipboardList className={cn('w-3.5 h-3.5', source.pending ? 'text-amber-500' : 'text-primary')} />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Plan</span>
              {source.pending && (
                <span className="px-1.5 py-[1px] rounded-full bg-amber-500/15 text-amber-500 text-[10px] font-medium leading-none">
                  Draft
                </span>
              )}
              <button
                onClick={() => setOpen(false)}
                title="Collapse plan"
                className="ml-auto p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/40"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="px-3 py-2 border-b border-border/40 flex-shrink-0 space-y-1">
              <p className="text-[11px] text-foreground/85 line-clamp-2 leading-snug">{summaryTitle}</p>
              <button
                onClick={openInSidePanel}
                title="Open in the Plan side panel (edit, comment, revise)"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>Open in Plan view</span>
                <ArrowUpRight className="w-3 h-3" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-2">
              {sectionList}
            </div>
          </div>
        ) : (
          <button
            onClick={() => setOpen(true)}
            title="Show plan"
            className="w-9 h-full flex flex-col items-center gap-2 py-2.5 hover:bg-muted/20 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
            <ClipboardList className={cn('w-3.5 h-3.5', source.pending ? 'text-amber-500' : 'text-primary')} />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground [writing-mode:vertical-rl]">
              Plan
            </span>
          </button>
        )}
      </motion.div>
    );
  }

  // ── Default: top strip, collapsing vertically from the top ─────────────────
  return (
    <div className={cn(
      'flex-shrink-0 border-b',
      source.pending
        ? 'border-amber-500/25 bg-amber-500/[0.04]'
        : 'border-primary/25 bg-primary/[0.04]',
    )}>
      <div className="flex items-center gap-2 px-3 h-8">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left hover:opacity-90 transition-opacity"
          aria-expanded={open}
        >
          <ClipboardList className={cn('w-3.5 h-3.5 flex-shrink-0', source.pending ? 'text-amber-500' : 'text-primary')} />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex-shrink-0">
            Plan
          </span>
          <span className="text-[11px] text-foreground/85 truncate min-w-0">{summaryTitle}</span>
          {stepCount > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground/70 flex-shrink-0">
              · {stepCount} section{stepCount === 1 ? '' : 's'}
            </span>
          )}
          {source.pending && (
            <span className="px-1.5 py-[1px] rounded-full bg-amber-500/15 text-amber-500 text-[10px] font-medium leading-none flex-shrink-0">
              Draft
            </span>
          )}
          <ChevronDown className={cn('w-3 h-3 flex-shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
        <button
          onClick={openInSidePanel}
          title="Open in the Plan side panel (edit, comment, revise)"
          className="flex items-center gap-1 flex-shrink-0 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <span>Open in Plan view</span>
          <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="max-h-64 overflow-y-auto px-3 pb-3 pt-1 space-y-2 border-t border-border/40">
              {sectionList}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
