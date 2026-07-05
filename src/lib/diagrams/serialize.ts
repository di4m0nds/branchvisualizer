// ─── Excalidraw scene → agent-readable text ──────────────────────────────────
// Deterministic, compact serialization of a scene's STRUCTURE: shapes with
// their bound labels become nodes, arrows with element bindings become edges,
// frames become groupings, loose text becomes annotations. Raw scene JSON is
// token-hostile (coordinates, styling); this is what the agent actually needs
// to treat a diagram as a spec ("implement this architecture").

/** The subset of the Excalidraw element model the serializer reads. */
export interface SceneElement {
  id: string;
  type: string;
  isDeleted?: boolean;
  text?: string;
  originalText?: string;
  containerId?: string | null;
  boundElements?: Array<{ id: string; type: string }> | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  frameId?: string | null;
  name?: string | null; // frames
}

export interface SceneLike {
  elements: SceneElement[];
}

/** Shape types that read as diagram nodes. */
const NODE_TYPES = new Set(['rectangle', 'ellipse', 'diamond', 'image', 'embeddable']);
const SHORT_TYPE: Record<string, string> = {
  rectangle: 'rect', ellipse: 'ellipse', diamond: 'diamond', image: 'image', embeddable: 'embed',
};

function labelOf(el: SceneElement, textByContainer: Map<string, string>): string {
  return textByContainer.get(el.id) ?? '';
}

function quote(s: string): string {
  return `"${s.replace(/\s+/g, ' ').trim().replace(/"/g, '\\"')}"`;
}

/**
 * Serialize a scene to the line-oriented `<diagram>` block. Returns the block,
 * or a short placeholder for an empty scene.
 */
export function sceneToText(scene: SceneLike, name: string): string {
  const live = (scene.elements ?? []).filter((e) => e && !e.isDeleted);

  // Bound text: text elements whose containerId points at a shape/arrow.
  const textByContainer = new Map<string, string>();
  for (const el of live) {
    if (el.type === 'text' && el.containerId) {
      textByContainer.set(el.containerId, (el.originalText ?? el.text ?? '').trim());
    }
  }

  // Frames (named groupings).
  const frames = new Map<string, string>(); // frameId -> frame name
  for (const el of live) {
    if (el.type === 'frame') frames.set(el.id, (el.name ?? 'Frame').trim() || 'Frame');
  }

  // Nodes with short ids in document order.
  const nodes = live.filter((e) => NODE_TYPES.has(e.type));
  const nodeId = new Map<string, string>();
  nodes.forEach((n, i) => nodeId.set(n.id, `N${i + 1}`));

  const nodeLines = nodes.map((n) => {
    const label = labelOf(n, textByContainer);
    const frame = n.frameId ? frames.get(n.frameId) : undefined;
    return [
      nodeId.get(n.id),
      SHORT_TYPE[n.type] ?? n.type,
      label ? quote(label) : '(unlabeled)',
      ...(frame ? [`(frame: ${quote(frame)})`] : []),
    ].join(' ');
  });

  // Edges: arrows; unbound endpoints render as (free).
  const arrows = live.filter((e) => e.type === 'arrow');
  const endpoint = (binding: { elementId: string } | null | undefined): string => {
    if (!binding) return '(free)';
    return nodeId.get(binding.elementId)
      // Arrows can bind to text/frames too — fall back to the raw label.
      ?? (textByContainer.get(binding.elementId)
        ? quote(textByContainer.get(binding.elementId)!)
        : '(other)');
  };
  const edgeLines = arrows.map((a) => {
    const label = labelOf(a, textByContainer);
    return `${endpoint(a.startBinding)} -> ${endpoint(a.endBinding)}${label ? ` ${quote(label)}` : ''}`;
  });

  // Loose text (not bound to any container) = annotations.
  const freeText = live
    .filter((e) => e.type === 'text' && !e.containerId)
    .map((e) => (e.originalText ?? e.text ?? '').trim())
    .filter(Boolean)
    .map((t) => `text: ${quote(t)}`);

  // Empty frames still communicate intent.
  const frameLines = [...frames.values()].map((f) => `frame: ${quote(f)}`);

  const body = [...nodeLines, ...edgeLines, ...frameLines, ...freeText];
  if (body.length === 0) {
    return `<diagram name=${quote(name)} empty="true" />`;
  }
  return [
    `<diagram name=${quote(name)} nodes="${nodes.length}" edges="${arrows.length}">`,
    ...body,
    '</diagram>',
  ].join('\n');
}
