import type { AgentBlock } from '@/types/session';
import CodeFrame from '../CodeFrame';
import { LabeledCard } from './LabeledCard';

// Shared block adapters used by several registry entries. They live apart from
// registry.tsx so that file only exports non-components (react-refresh warns on
// files mixing component and non-component exports).

// Label-only signal blocks (file_changes, editor_sync,
// branch_visualizer_refresh, nvim_command) — label derived from the type.
export function TypeLabeledBlock({ block }: { block: AgentBlock }) {
  return <LabeledCard label={block.type.replace(/_/g, ' ')} inner={String(block.data?.inner ?? '')} />;
}

// Raw-code blocks (code_file, code_diff).
export function CodeFrameBlock({ block }: { block: AgentBlock }) {
  return <CodeFrame code={String(block.data?.inner ?? '')} />;
}

// Fallback for unknown block types — generic titled card, matching the old
// switch's `default` case.
export function FallbackBlock({ block }: { block: AgentBlock }) {
  const inner = String(block.data?.inner ?? '');
  return <LabeledCard label={block.type} inner={inner || block.raw} />;
}
