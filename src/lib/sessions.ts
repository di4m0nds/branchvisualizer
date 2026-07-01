// Session factory. Creates a fresh Session tied to a specific Project rather
// than whichever repo the app-global state currently holds — this decouples
// thread creation from the currently-loaded view (fixing a pre-existing bug
// where the "+" button would attach the new session to a different repo).

import type { AgentDefaults } from './agentDefaults';
import type { Project, Session } from '@/types/session';
import { createDefaultContext, nextId } from '@/types/session';

export function createSession(project: Project, defaults: AgentDefaults): Session {
  const context = createDefaultContext();
  return {
    id: nextId('session'),
    title: project.name || 'Session',
    projectId: project.id,
    repoSource: project.source,
    repoRef: project.path,
    cwd: project.source === 'local' ? project.path : null,
    context: {
      ...context,
      accessLevel: defaults.accessLevel,
      buildMode: defaults.buildMode,
    },
    messages: [],
    terminals: [],
  };
}
