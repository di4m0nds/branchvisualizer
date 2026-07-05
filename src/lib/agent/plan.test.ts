import { describe, expect, it } from 'vitest';
import { allPlans, latestPlanText } from './plan';
import { createDefaultContext, type AgentMessage, type Session } from '@/types/session';

function planMsg(id: string, body: string): AgentMessage {
  return {
    id,
    role: 'assistant',
    text: `<plan>${body}</plan>`,
    blocks: [{ type: 'plan', raw: `<plan>${body}</plan>`, data: { inner: body } }],
    ts: '2026-07-05T00:00:00.000Z',
  };
}

function userMsg(id: string, text: string): AgentMessage {
  return { id, role: 'user', text, blocks: [], ts: '2026-07-05T00:00:00.000Z' };
}

function session(messages: AgentMessage[]): Session {
  return {
    id: 's1',
    title: 't',
    projectId: 'p1',
    repoSource: 'local',
    repoRef: '/tmp',
    cwd: '/tmp',
    context: createDefaultContext(),
    messages,
    terminals: [],
  } as Session;
}

describe('allPlans', () => {
  it('returns every plan block oldest → newest, skipping non-plan messages', () => {
    const s = session([
      userMsg('u1', 'plan A'),
      planMsg('m1', '# First plan\n\n1. do a'),
      userMsg('u2', 'revise'),
      planMsg('m2', '# Second plan\n\n1. do b'),
    ]);
    const plans = allPlans(s);
    expect(plans.map((p) => p.messageId)).toEqual(['m1', 'm2']);
    expect(plans[0].text).toContain('First plan');
    expect(plans[1].text).toContain('Second plan');
  });

  it('marks only the newest plan pending while planning', () => {
    const s = session([planMsg('m1', 'a'), planMsg('m2', 'b')]);
    s.context.buildMode = 'planning';
    const plans = allPlans(s);
    expect(plans[0].pending).toBe(false);
    expect(plans[1].pending).toBe(true);
  });

  it('latestPlanText equals the last entry of allPlans', () => {
    const s = session([planMsg('m1', 'a'), planMsg('m2', 'b')]);
    expect(latestPlanText(s)?.messageId).toBe('m2');
    expect(latestPlanText(s)).toEqual(allPlans(s).at(-1));
  });

  it('returns [] / null when no plan exists', () => {
    const s = session([userMsg('u1', 'hi')]);
    expect(allPlans(s)).toEqual([]);
    expect(latestPlanText(s)).toBeNull();
  });
});
