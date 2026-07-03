import { describe, it, expect } from 'vitest';
import { parseAgentBlocks, type PlanStep, type StatusFile } from './blocks';

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
});
