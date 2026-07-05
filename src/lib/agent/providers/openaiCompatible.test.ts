import { describe, expect, it } from 'vitest';
import { iterateSSE, toChatMessages } from './openaiCompatible';
import type { NeutralMessage } from '../transport';

describe('toChatMessages', () => {
  it('maps system + text turns', () => {
    const msgs: NeutralMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ];
    const out = toChatMessages('SYS', msgs);
    expect(out).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'hi', tool_calls: undefined },
      { role: 'assistant', content: 'hello', tool_calls: undefined },
    ]);
  });

  it('maps tool_use to tool_calls and tool_result to role:tool', () => {
    const msgs: NeutralMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'running' },
          { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'a.ts' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: 'file body' }] },
    ];
    const out = toChatMessages('S', msgs);
    expect(out[1].tool_calls).toEqual([
      { id: 't1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
    ]);
    expect(out[2]).toEqual({ role: 'tool', tool_call_id: 't1', content: 'file body' });
    // thinking blocks are dropped silently
    expect(toChatMessages('S', [{ role: 'assistant', content: [{ type: 'thinking', text: 'hmm' }] }])).toHaveLength(1);
  });
});

function sseResponse(frames: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(new TextEncoder().encode(f));
      controller.close();
    },
  });
  return new Response(body);
}

describe('iterateSSE', () => {
  it('parses data frames, skips malformed and [DONE]', async () => {
    const res = sseResponse([
      'data: {"choices":[{"delta":{"content":"he"}}]}\n',
      'data: {"choices":[{"delta":{"content":"llo"}},',   // split across reads…
      '{"bogus"}]}\n',                                     // …reassembled then malformed → skipped
      ': comment\n',
      'data: {"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n',
      'data: [DONE]\n',
    ]);
    const chunks = [];
    for await (const c of iterateSSE(res)) chunks.push(c);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].choices?.[0]?.delta?.content).toBe('he');
    expect(chunks[1].usage?.total_tokens).toBe(15);
  });
});
