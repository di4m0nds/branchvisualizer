import { memo, useEffect, useState } from 'react';
import { Activity, Cpu, MemoryStick } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/platform';
import { usePageVisible } from '@/hooks/usePageVisible';
import { fmtBytes, systemSnapshot, type SystemSnapshot } from '@/lib/system';
import SystemPanel from './SystemPanel';

// ─── IDE status bar ──────────────────────────────────────────────────────────
// Slim always-visible machine vitals at the bottom of the IDE: CPU %, RAM, the
// app's own footprint, and load. Click to expand the full system panel
// (processes / ports / disks / kill). Polls every 2s, paused when hidden.

const POLL_MS = 2000;

function pctColor(pct: number): string {
  return pct >= 90 ? 'text-red-400' : pct >= 70 ? 'text-amber-400' : 'text-muted-foreground';
}

export default memo(function StatusBar() {
  const pageVisible = usePageVisible();
  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isTauri() || !pageVisible) return;
    let alive = true;
    const tick = () => systemSnapshot().then((s) => { if (alive) setSnap(s); }).catch(() => {});
    tick();
    const iv = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(iv); };
  }, [pageVisible]);

  if (!isTauri()) return null;

  const memPct = snap && snap.memTotal > 0 ? (snap.memUsed / snap.memTotal) * 100 : 0;

  return (
    <>
      {open && <SystemPanel onClose={() => setOpen(false)} snapshot={snap} />}
      <button
        onClick={() => setOpen((v) => !v)}
        title="System status — click for processes, ports, and disks"
        className={cn(
          'flex-shrink-0 w-full flex items-center gap-4 px-3 h-6 border-t border-border bg-muted/20',
          'text-[10px] font-mono text-muted-foreground hover:bg-muted/40 transition-colors',
        )}
      >
        <span className={cn('flex items-center gap-1', pctColor(snap?.cpuPct ?? 0))}>
          <Cpu className="w-3 h-3" />
          {snap ? `${snap.cpuPct.toFixed(0)}%` : '—'}
        </span>
        <span className={cn('flex items-center gap-1', pctColor(memPct))}>
          <MemoryStick className="w-3 h-3" />
          {snap ? `${fmtBytes(snap.memUsed)}/${fmtBytes(snap.memTotal)}` : '—'}
        </span>
        <span className="flex items-center gap-1" title="This app's memory / CPU">
          <Activity className="w-3 h-3" />
          IDE {snap ? `${fmtBytes(snap.appMem)} · ${snap.appCpuPct.toFixed(0)}%` : '—'}
        </span>
        <span className="ml-auto" title="1-minute load average">
          load {snap ? snap.loadAvgOne.toFixed(2) : '—'} · {snap?.cpuCount ?? '—'} cores
        </span>
      </button>
    </>
  );
});
