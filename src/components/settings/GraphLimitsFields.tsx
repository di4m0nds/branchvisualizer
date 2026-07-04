import { useState } from 'react';
import { getAppState } from '@/store/store';
import { useRepoData } from '@/hooks/useRepoData';
import {
  DEFAULT_GRAPH_LIMITS, loadGraphLimits, saveGraphLimits, type GraphLimits,
} from '@/lib/graphLimits';

// ─── Settings → General → graph fetch limits ─────────────────────────────────
// How much history the visualizer loads for large repos. Applied on the next
// repository (re)load — a one-click reload is offered when a repo is open.

const GH_COMMITS: [number, string][] = [[100, '100'], [150, '150 (default)'], [400, '400'], [1000, '1,000'], [0, 'Unlimited ⚠']];
const GH_BRANCHES: [number, string][] = [[10, '10'], [40, '40 (default)'], [100, '100'], [0, 'All ⚠']];
const LOCAL_COMMITS: [number, string][] = [[1000, '1,000'], [2000, '2,000 (default)'], [5000, '5,000'], [20000, '20,000'], [0, 'Unlimited ⚠']];

export default function GraphLimitsFields() {
  const [limits, setLimits] = useState<GraphLimits>(loadGraphLimits);
  const { loadRepo, loadLocalRepo } = useRepoData();

  const update = (patch: Partial<GraphLimits>) => {
    const next = { ...limits, ...patch };
    setLimits(next);
    saveGraphLimits(next);
  };

  const reload = () => {
    const { source, localPath, repoInfo } = getAppState();
    if (source === 'local' && localPath) void loadLocalRepo(localPath);
    else if (repoInfo) void loadRepo(`https://github.com/${repoInfo.fullName}`);
  };

  const repoLoaded = !!getAppState().graphData;

  return (
    <>
      <Row
        title="GitHub commits per branch"
        desc="Fetched in pages of 100 per branch. Higher = deeper history, slower load and more API quota."
        value={limits.githubCommitsPerBranch}
        options={GH_COMMITS}
        onChange={(v) => update({ githubCommitsPerBranch: v })}
      />
      <Row
        title="GitHub branches"
        desc="How many branches the graph walks."
        value={limits.githubBranches}
        options={GH_BRANCHES}
        onChange={(v) => update({ githubBranches: v })}
      />
      <Row
        title="Local repo commits"
        desc="git log --all cap for local repositories. Rendering is viewport-culled; this bounds fetch time and layout memory."
        value={limits.localMaxCommits}
        options={LOCAL_COMMITS}
        onChange={(v) => update({ localMaxCommits: v })}
      />
      <div className="flex items-center justify-between py-2">
        <p className="text-[10px] text-muted-foreground/60">
          Defaults: {DEFAULT_GRAPH_LIMITS.githubCommitsPerBranch}/{DEFAULT_GRAPH_LIMITS.githubBranches}/{DEFAULT_GRAPH_LIMITS.localMaxCommits.toLocaleString()}. Applied on the next repository load.
        </p>
        {repoLoaded && (
          <button
            onClick={reload}
            className="px-2.5 py-1 rounded text-[11px] border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            Reload repository now
          </button>
        )}
      </div>
    </>
  );
}

function Row({ title, desc, value, options, onChange }: {
  title: string; desc: string; value: number; options: [number, string][]; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3 border-b border-border/60">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-relaxed">{desc}</p>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-shrink-0 text-[11px] bg-muted/30 border border-border rounded px-2 py-1.5 text-foreground focus:outline-none focus:border-ring"
      >
        {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </div>
  );
}
