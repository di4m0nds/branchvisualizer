// ─── Routed session-title generation ─────────────────────────────────────────
// When the user routes the `title` task to a (cheap) model, the first message
// of a session gets a model-written title. Fire-and-forget: the local
// heuristic title (reducers/sessions.ts deriveSessionTitle) has already been
// applied instantly, so any failure here simply keeps it — routing degrades
// seamlessly when the provider is unavailable.

import type { AppAction, ModelRef } from '@/types';
import type { ProbeResult } from './transport';
import { findProvider } from './providers';
import { renderPrompt } from './prompts';
import { loadRouting, resolveTaskModel } from './modelRouting';
import { log, swallow } from '../log';

const TITLE_MAX = 48;

function sanitizeTitle(raw: string): string | null {
  const line = raw.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const clean = line.replace(/^["'`#*\s]+|["'`.\s]+$/g, '').replace(/\s+/g, ' ');
  if (!clean || clean.length < 3) return null;
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1).trimEnd()}…` : clean;
}

/**
 * Generate a session title with the routed `title` model, if one is configured
 * and connected. No-op otherwise. Never throws.
 */
export async function maybeGenerateTitle(
  sessionId: string,
  firstMessage: string,
  sessionModel: ModelRef,
  providerStatus: Record<string, ProbeResult>,
  dispatch: (a: AppAction) => void,
): Promise<void> {
  const routing = loadRouting();
  // Only act when the user explicitly routed titles — the session model is
  // typically expensive and the local heuristic is free.
  const route = routing.title;
  if (!route || route === 'session') return;
  const { model, routed } = resolveTaskModel('title', sessionModel, providerStatus, routing);
  if (!routed) return; // provider not connected — keep the heuristic title

  try {
    const provider = findProvider(model.providerId);
    if (!provider) return;
    const transport = await provider.createTransport(model.modelId, model.context);
    const resp = await transport.createMessage({
      system: 'You generate short session titles. Reply with the title only.',
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: renderPrompt('title_generate', { message: firstMessage.slice(0, 2000) }) }],
      }],
      tools: [],
      maxTokens: 64,
      effort: 'low',
      thinking: false,
    }, {});
    const text = resp.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join(' ');
    const title = sanitizeTitle(text);
    if (title) {
      dispatch({ type: 'RENAME_SESSION', id: sessionId, title });
      log.debug('autoTitle', `routed title via ${model.providerId}:${model.modelId}`, title);
    }
  } catch (e) {
    swallow('autoTitle', 'generation failed — heuristic title kept')(e);
  }
}
