// Session factory. Creates a fresh Session tied to a specific Project rather
// than whichever repo the app-global state currently holds — this decouples
// thread creation from the currently-loaded view (fixing a pre-existing bug
// where the "+" button would attach the new session to a different repo).

import type { AgentDefaults } from './agentDefaults';
import type { ModelRef } from '@/types';
import type { Project, Session } from '@/types/session';
import { createDefaultContext, nextId } from '@/types/session';

export function createSession(project: Project, defaults: AgentDefaults, model?: ModelRef): Session {
  const context = createDefaultContext();
  return {
    id: nextId('session'),
    // Placeholder until the first user message auto-derives a real title (see
    // ADD_AGENT_MESSAGE in the reducer). Kept distinct from the project name so
    // sessions don't visually repeat their project's label in the sidebar.
    title: 'New session',
    projectId: project.id,
    repoSource: project.source,
    repoRef: project.path,
    cwd: project.source === 'local' ? project.path : null,
    // Seed from the app-global default model; the session owns its copy from
    // here on (per-session model config).
    ...(model ? { modelConfig: { model: { ...model } } } : {}),
    context: {
      ...context,
      accessLevel: defaults.accessLevel,
      buildMode: defaults.buildMode,
    },
    messages: [],
    terminals: [],
  };
}
