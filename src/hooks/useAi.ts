// apps/branchvisualizer/src/hooks/useAi.ts
// Streaming AI hook — calls @codeatlas/ai directly (direct mode) or backend
// proxy (/api/ai/stream). Features: 300ms debounce, AbortController per
// request, race-condition guard, UUID requestId for tracing,
// sessionStorage for API keys.

import { useState, useCallback, useRef, useEffect } from 'react';
import { streamAI } from '@codeatlas/ai';

// ─── Types ────────────────────────────────────────────────────────────────────

export type { AIProviderId } from '@codeatlas/ai';

/**
 * Minimal prompt shape the hook actually needs.
 * BuiltPrompt from ai-prompts is a superset and satisfies this interface.
 */
export interface AiPrompt {
  system: string;
  user: string;
  /** Optional metadata fields (unused by hook, kept for compatibility with BuiltPrompt). */
  featureId?: string;
  promptVersion?: string;
}

export interface AIConfig {
  provider: import('@codeatlas/ai').AIProviderId;
  model: string;
  /** API key stored in sessionStorage — never persisted to localStorage. */
  apiKey?: string;
  /** Use backend proxy instead of calling provider directly from browser. */
  useProxy: boolean;
}

export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5',
  useProxy: false,
};

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

// ─── Editor state snapshot (used by EditorToolbar) ───────────────────────────

export interface EditorState {
  path: string;
  language: string;
  selectedText: string;
  cursorLine: number;
  visibleRangeStart: number;
  visibleRangeEnd: number;
}

/**
 * Derives a snapshot of editor state from an OpenFile record.
 * Returns null when no file is open.
 */
export function getEditorState(
  openFile: { path: string; content: string; language: string; cursorLine: number; selectionStart?: { line: number; column: number }; selectionEnd?: { line: number; column: number } } | null
): EditorState | null {
  if (!openFile) return null;

  const lines = openFile.content.split('\n');
  const totalLines = lines.length;

  let selectedText = '';
  if (openFile.selectionStart && openFile.selectionEnd) {
    const startLine = openFile.selectionStart.line - 1;
    const endLine = openFile.selectionEnd.line - 1;
    if (startLine === endLine) {
      selectedText = lines[startLine]?.slice(
        openFile.selectionStart.column - 1,
        openFile.selectionEnd.column - 1
      ) ?? '';
    } else {
      const parts = [lines[startLine]?.slice(openFile.selectionStart.column - 1) ?? ''];
      for (let i = startLine + 1; i < endLine; i++) parts.push(lines[i] ?? '');
      parts.push(lines[endLine]?.slice(0, openFile.selectionEnd.column - 1) ?? '');
      selectedText = parts.join('\n');
    }
  }

  const VISIBLE_CONTEXT = 50;
  const visibleRangeStart = Math.max(1, openFile.cursorLine - VISIBLE_CONTEXT);
  const visibleRangeEnd = Math.min(totalLines, openFile.cursorLine + VISIBLE_CONTEXT);

  return {
    path: openFile.path,
    language: openFile.language,
    selectedText,
    cursorLine: openFile.cursorLine,
    visibleRangeStart,
    visibleRangeEnd,
  };
}

export interface UseAiResult {
  output: string;
  loading: boolean;
  error: string | null;
  requestId: string | null;
  tokenUsage: TokenUsage | null;
  run: (prompt: AiPrompt, config: AIConfig) => void;
  cancel: () => void;
  clear: () => void;
}

// ─── UUID helper ─────────────────────────────────────────────────────────────

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ─── Direct provider stream ───────────────────────────────────────────────────
// Thin adapter: converts AIStreamChunk objects from @codeatlas/ai into strings.

async function* streamDirect(
  prompt: AiPrompt,
  config: AIConfig,
  signal: AbortSignal,
  onDone?: (tokens: { input?: number; output?: number }) => void,
): AsyncGenerator<string> {
  for await (const chunk of streamAI({
    provider: config.provider,
    model: config.model,
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user',   content: prompt.user   },
    ],
    apiKey: config.apiKey,
    signal,
  })) {
    if (chunk.type === 'delta') yield chunk.text;
    if (chunk.type === 'error') throw new Error(chunk.message);
    if (chunk.type === 'done') {
      onDone?.({ input: chunk.inputTokens, output: chunk.outputTokens ?? chunk.totalTokens });
    }
  }
}

// ─── Proxy stream ─────────────────────────────────────────────────────────────

async function* streamProxy(
  prompt: AiPrompt,
  config: AIConfig,
  requestId: string,
  signal: AbortSignal,
  onDone?: (tokens: { input?: number; output?: number }) => void,
): AsyncGenerator<string> {
  const resp = await fetch('/api/ai/stream', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId,
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      system: prompt.system,
      user: prompt.user,
    }),
  });
  if (!resp.ok) throw new Error(`AI proxy ${resp.status}: ${await resp.text().catch(() => '')}`);

  const reader = resp.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return;
      try {
        const j = JSON.parse(data);
        if (j.type === 'delta') yield j.text ?? '';
        if (j.type === 'done') {
          onDone?.({ input: j.inputTokens, output: j.outputTokens ?? j.totalTokens });
          return;
        }
        if (j.type === 'error') throw new Error(j.message ?? 'Stream error');
      } catch (e) {
        if ((e as Error)?.message?.startsWith('Stream error') ||
            !(e instanceof SyntaxError)) throw e;
      }
    }
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAi(): UseAiResult {
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runIdRef = useRef(0);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLoading(false);
  }, []);

  const clear = useCallback(() => {
    cancel();
    setOutput('');
    setError(null);
    setRequestId(null);
    setTokenUsage(null);
  }, [cancel]);

  const run = useCallback((prompt: AiPrompt, config: AIConfig) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const rid = uuid();
      const thisRunId = ++runIdRef.current;

      setOutput('');
      setError(null);
      setLoading(true);
      setRequestId(rid);
      setTokenUsage(null);

      const onDone = (tokens: { input?: number; output?: number }) => {
        if (thisRunId !== runIdRef.current) return;
        const input = tokens.input ?? 0;
        const out = tokens.output ?? 0;
        setTokenUsage({ input, output: out, total: input + out });
      };

      try {
        const source = (!config.useProxy && config.apiKey)
          ? streamDirect(prompt, config, controller.signal, onDone)
          : streamProxy(prompt, config, rid, controller.signal, onDone);

        for await (const text of source) {
          if (thisRunId !== runIdRef.current || controller.signal.aborted) return;
          setOutput(prev => prev + text);
        }
        if (thisRunId === runIdRef.current) setLoading(false);
      } catch (err) {
        if (thisRunId !== runIdRef.current) return;
        if ((err as Error)?.name === 'AbortError') { setLoading(false); return; }
        setError((err as Error)?.message ?? 'Unknown error');
        setLoading(false);
      }
    }, 300);
  }, []);

  useEffect(() => () => {
    abortRef.current?.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  return { output, loading, error, requestId, tokenUsage, run, cancel, clear };
}
