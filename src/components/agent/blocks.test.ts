import { describe, it, expect } from 'vitest';
import { filterBlocksByDensity, parseAgentBlocks, type PlanStep, type StatusFile } from './blocks';
import type { AgentBlock } from '@/types/session';

describe('parseAgentBlocks — self-closing + hydration', () => {
  it('parses a self-closing session_state_change (no raw-text leak)', () => {
    const text = 'Done.\n<session_state_change from="idle" to="pending_plan_approval" reason="Plan ready" />';
    const blocks = parseAgentBlocks(text);
    const state = blocks.find((b) => b.type === 'session_state_change');
    expect(state).toBeDefined();
    expect(state!.data?.to).toBe('pending_plan_approval');
    expect(state!.data?.reason).toBe('Plan ready');
    // The tag must NOT survive as a text block.
    expect(blocks.some((b) => b.type === 'text' && b.raw.includes('<session_state_change'))).toBe(false);
  });

  it('hydrates a plan into title/objective/steps', () => {
    const text =
      '<plan><title>Remove diamonds</title><objective>Strip decorative gems</objective>' +
      '<scope><in_scope>Frame.tsx</in_scope><out_of_scope>Layout</out_of_scope></scope>' +
      '<steps>' +
      '<step index="1" status="pending" estimated_complexity="low"><title>Locate file</title><description>grep it</description><files_affected>N/A</files_affected></step>' +
      '<step index="2" status="pending" estimated_complexity="medium"><title>Remove</title><description>delete svg</description></step>' +
      '</steps><total_estimated_complexity>medium</total_estimated_complexity></plan>';
    const plan = parseAgentBlocks(text).find((b) => b.type === 'plan');
    expect(plan).toBeDefined();
    expect(plan!.data?.planTitle).toBe('Remove diamonds');
    expect(plan!.data?.objective).toBe('Strip decorative gems');
    expect(plan!.data?.complexity).toBe('medium');
    const steps = plan!.data?.steps as PlanStep[];
    expect(steps).toHaveLength(2);
    expect(steps[0].title).toBe('Locate file');
    expect(steps[1].complexity).toBe('medium');
    // No raw <step> / <title> leaking as text.
    expect(parseAgentBlocks(text).some((b) => b.type === 'text' && b.raw.includes('<step'))).toBe(false);
  });

  it('keeps markdown-relevant characters intact through plan hydration', () => {
    const text =
      '<plan><title>Refactor auth</title><objective>Replace `sessions` with **JWT**</objective>' +
      '<steps>' +
      '<step index="1" status="pending" estimated_complexity="low"><title>Read code</title>' +
      '<description>Look at `src/**/auth.ts` — inspect **all** middleware</description>' +
      '<files_affected>src/auth.ts</files_affected></step>' +
      '</steps></plan>';
    const plan = parseAgentBlocks(text).find((b) => b.type === 'plan');
    expect(plan?.data?.objective).toBe('Replace `sessions` with **JWT**');
    const steps = plan?.data?.steps as PlanStep[];
    expect(steps[0].description).toBe('Look at `src/**/auth.ts` — inspect **all** middleware');
  });

  it('derives a preview + markdown fallback for a markdown-body plan', () => {
    const text =
      '<plan># Improve the footer\n\n1. Find footer files\n2. Restyle\n3. Verify build</plan>';
    const plan = parseAgentBlocks(text).find((b) => b.type === 'plan');
    expect(plan?.data?.planTitle).toBe('Improve the footer');
    expect(plan?.data?.derivedStepCount).toBe(3);
    expect(plan?.data?.derivedStepTitles).toEqual(['Find footer files', 'Restyle', 'Verify build']);
    expect(String(plan?.data?.markdownFallback)).toContain('Find footer files');
    expect(plan?.data?.steps).toEqual([]);
  });

  it('hydrates a goal_plan block into tasks (no raw JSON dump)', () => {
    const text =
      'Plan below.\n<goal_plan>[{"id":"t1","title":"Find files","deps":[]},' +
      '{"id":"t2","title":"Restyle","deps":["t1"],"needsApproval":true}]</goal_plan>';
    const blocks = parseAgentBlocks(text);
    const gp = blocks.find((b) => b.type === 'goal_plan');
    expect(gp).toBeDefined();
    const tasks = gp!.data?.tasks as Array<{ id: string; title: string }>;
    expect(tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(blocks.some((b) => b.type === 'text' && b.raw.includes('"t1"'))).toBe(false);
  });

  it('hydrates agent_status files/commands (no raw XML leak)', () => {
    const text =
      '<agent_status><state>working</state>' +
      '<files_touched><file path="app/globals.css" action="read" /></files_touched>' +
      '<commands_run><command status="complete">grep -r foo</command></commands_run>' +
      '<messages /></agent_status>';
    const status = parseAgentBlocks(text).find((b) => b.type === 'agent_status');
    expect(status).toBeDefined();
    const files = status!.data?.files as StatusFile[];
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('app/globals.css');
    expect((status!.data?.commands as { cmd: string }[])[0].cmd).toBe('grep -r foo');
  });

  it('still renders ordinary prose as a text block', () => {
    const blocks = parseAgentBlocks('Here is some **markdown** with `code`.');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
  });

  it('parses agent_error blocks with a kind attribute', () => {
    const blocks = parseAgentBlocks('<agent_error kind="provider">rate limited</agent_error>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('agent_error');
    expect(blocks[0].data?.inner).toBe('rate limited');
    expect(blocks[0].data?.attrs).toContain('kind="provider"');
  });
});

describe('filterBlocksByDensity — density is presentation, not filtering', () => {
  const b = (type: string, data?: Record<string, unknown>): AgentBlock => ({ type, raw: '', data });
  const blocks: AgentBlock[] = [
    b('thinking'),
    b('action_log', { tool: 'grep' }),
    b('action_log', { tool: 'run_command' }),
    b('code_diff'),
    b('agent_error'),
    b('text'),
    b('session_state_change'),
    b('agent_status'),
    b('editor_sync'),
  ];

  it('verbose keeps everything', () => {
    expect(filterBlocksByDensity(blocks, 'verbose')).toHaveLength(blocks.length);
  });

  it('clean keeps tool logs, thinking, diffs, and errors — drops only noise chips', () => {
    const kept = filterBlocksByDensity(blocks, 'clean').map((x) => x.type);
    expect(kept).toEqual(['thinking', 'action_log', 'action_log', 'code_diff', 'agent_error', 'text']);
  });
});
