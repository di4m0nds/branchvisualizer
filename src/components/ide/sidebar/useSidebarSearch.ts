// Client-side substring search across projects + threads. A matching project
// name includes all its threads; otherwise a project is included only if one
// of its threads matches. Empty query short-circuits (no filter). Archived
// threads are always excluded unless `showArchived` is set — the search should
// never surface items the user can't see with the current toggle state.

import { useMemo } from 'react';
import type { Project, Session } from '@/types/session';

export interface FilteredProject {
  project: Project;
  threads: Session[];
  /** True when the project's own name matched (widen — show all threads). */
  projectHit: boolean;
  /** True when at least one thread matched (auto-expand during search). */
  threadHit: boolean;
}

export function useSidebarSearch(
  projects: Project[],
  sessionsByProject: Map<string, Session[]>,
  query: string,
  showArchived: boolean,
): FilteredProject[] {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    const visibleThreads = (id: string) => {
      const all = sessionsByProject.get(id) ?? [];
      return showArchived ? all : all.filter((s) => !s.archived);
    };
    return projects.reduce<FilteredProject[]>((acc, project) => {
      const threads = visibleThreads(project.id);
      if (!q) {
        acc.push({ project, threads, projectHit: false, threadHit: false });
        return acc;
      }
      const projectHit = project.name.toLowerCase().includes(q)
        || project.path.toLowerCase().includes(q);
      if (projectHit) {
        acc.push({ project, threads, projectHit: true, threadHit: false });
        return acc;
      }
      const matching = threads.filter((s) => s.title.toLowerCase().includes(q));
      if (matching.length > 0) {
        acc.push({ project, threads: matching, projectHit: false, threadHit: true });
      }
      return acc;
    }, []);
  }, [projects, sessionsByProject, query, showArchived]);
}
