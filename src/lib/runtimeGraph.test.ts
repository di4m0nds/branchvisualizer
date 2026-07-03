import { describe, it, expect } from 'vitest';
import { composeToGraphData } from './runtimeGraph';
import type { ComposeService } from '@/types/runtime';

const svc = (name: string, dependsOn: string[] = []): ComposeService => ({
  name, dependsOn, image: `${name}:latest`, ports: [],
});

describe('composeToGraphData', () => {
  it('produces a node per service', () => {
    const g = composeToGraphData([svc('web'), svc('db'), svc('cache')]);
    expect(g.nodes).toHaveLength(3);
    expect(g.commitMap.has('web')).toBe(true);
  });

  it('creates an edge for each depends_on', () => {
    const g = composeToGraphData([svc('web', ['db', 'cache']), svc('db'), svc('cache')]);
    const edgeKeys = g.edges.map((e) => `${e.fromSha}->${e.toSha}`);
    expect(edgeKeys).toContain('web->db');
    expect(edgeKeys).toContain('web->cache');
  });

  it('drops depends_on pointing at unknown services', () => {
    const g = composeToGraphData([svc('web', ['ghost'])]);
    expect(g.nodes).toHaveLength(1);
    expect(g.edges).toHaveLength(0);
  });

  it('returns an empty graph for no services', () => {
    const g = composeToGraphData([]);
    expect(g.nodes).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
  });
});
