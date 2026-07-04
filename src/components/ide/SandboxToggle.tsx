import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { invoke, isTauri, listen, type Unlisten } from '@/lib/platform';
import { useAsyncResource } from '@/hooks/useAsyncResource';
import { useAppDispatch } from '@/store/store';
import { swallow } from '@/lib/log';
import { toast } from '@/services/toast';
import type { Session } from '@/types/session';

interface SandboxStatus {
  engineOk: boolean;
  engineVersion: string | null;
  imageReady: boolean;
}

/**
 * Session-bar control for the Podman runtime sandbox: enable/disable, network
 * sub-toggle, engine/image status dot, and a one-click image build streaming
 * over the existing `runtime://` channel.
 */
export default function SandboxToggle({ session }: { session: Session }) {
  const dispatch = useAppDispatch();
  const sandbox = session.context.sandbox ?? { enabled: false, network: true };
  const [building, setBuilding] = useState(false);
  const buildIdRef = useRef<string | null>(null);

  const { data: status, reload: reprobe } = useAsyncResource<SandboxStatus>(
    () => invoke<SandboxStatus>('sandbox_status', { bin: 'podman' }),
    [],
    { enabled: isTauri(), scope: 'sandbox' },
  );

  // Re-probe when an image build finishes (runtime://exit for our stream id).
  useEffect(() => {
    if (!building || !isTauri()) return;
    let un: Unlisten | undefined;
    listen<{ id: string; code: number | null }>('runtime://exit', (p) => {
      if (p.id !== buildIdRef.current) return;
      setBuilding(false);
      if (p.code === 0) toast.success('Sandbox image built');
      else toast.error('Sandbox image build failed', { description: `podman build exited with ${p.code ?? '?'}` });
      reprobe();
    }).then((u) => { un = u; });
    return () => un?.();
  }, [building, reprobe]);

  if (!isTauri()) return null;

  const ready = !!status?.engineOk && !!status?.imageReady;
  const patch = (p: Partial<typeof sandbox>) =>
    dispatch({ type: 'PATCH_SESSION_CONTEXT', sessionId: session.id, patch: { sandbox: { ...sandbox, ...p } } });

  const startBuild = () => {
    const id = `sbx-build-${Date.now()}`;
    buildIdRef.current = id;
    setBuilding(true);
    invoke('sandbox_build', { id, bin: 'podman' }).catch((e) => {
      setBuilding(false);
      toast.error('Sandbox build failed to start', { description: String(e) });
      swallow('sandbox', 'build spawn')(e);
    });
  };

  return (
    <div className="flex items-center gap-1" title={statusHint(status, sandbox.enabled)}>
      <button
        onClick={() => {
          if (!sandbox.enabled && !ready) return; // can't enable without engine+image
          patch({ enabled: !sandbox.enabled });
        }}
        disabled={!sandbox.enabled && !status?.engineOk}
        className={cn(
          'flex items-center gap-1.5 px-1.5 py-1 rounded text-[10px] border transition-colors',
          sandbox.enabled
            ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400'
            : status?.engineOk
              ? 'border-border text-muted-foreground hover:text-foreground'
              : 'border-border text-muted-foreground/40 cursor-not-allowed',
        )}
      >
        <span className={cn(
          'w-1.5 h-1.5 rounded-full',
          sandbox.enabled ? 'bg-cyan-400' : ready ? 'bg-green-400/60' : 'bg-muted-foreground/40',
        )} />
        Sandbox
      </button>

      {/* Network sub-toggle — only meaningful while sandboxed */}
      {sandbox.enabled && (
        <button
          onClick={() => patch({ network: !sandbox.network })}
          title={sandbox.network
            ? 'Container network ON (npm installs work; residual risk)'
            : 'Container network OFF (--network none)'}
          className={cn(
            'px-1.5 py-1 rounded text-[10px] border transition-colors',
            sandbox.network
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
              : 'border-border text-muted-foreground hover:text-foreground',
          )}
        >
          net
        </button>
      )}

      {/* Build image when podman exists but the image doesn't */}
      {status?.engineOk && !status.imageReady && (
        <button
          onClick={startBuild}
          disabled={building}
          className="px-1.5 py-1 rounded text-[10px] border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          {building ? 'building…' : 'build image'}
        </button>
      )}
    </div>
  );
}

function statusHint(status: SandboxStatus | null, enabled: boolean): string {
  if (!status) return 'Probing podman…';
  if (!status.engineOk) return 'Podman not found on PATH — install podman to enable the runtime sandbox.';
  if (!status.imageReady) return `Podman ${status.engineVersion ?? ''} detected — build the sandbox image to enable isolation.`;
  return enabled
    ? 'Agent run_command executes inside an isolated Podman container (project bind-mounted).'
    : 'Sandbox ready — enable to run agent commands inside an isolated container.';
}
