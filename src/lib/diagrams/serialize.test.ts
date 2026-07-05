import { describe, expect, it } from 'vitest';
import { sceneToText, type SceneElement } from './serialize';

function rect(id: string, extra: Partial<SceneElement> = {}): SceneElement {
  return { id, type: 'rectangle', ...extra };
}
function boundText(id: string, containerId: string, text: string): SceneElement {
  return { id, type: 'text', containerId, text, originalText: text };
}

describe('sceneToText', () => {
  it('serializes labeled nodes and bound arrows', () => {
    const elements: SceneElement[] = [
      rect('a', { boundElements: [{ id: 'ta', type: 'text' }] }),
      boundText('ta', 'a', 'Client'),
      rect('b', { boundElements: [{ id: 'tb', type: 'text' }] }),
      boundText('tb', 'b', 'API Gateway'),
      { id: 'db', type: 'ellipse', boundElements: [{ id: 'tdb', type: 'text' }] },
      boundText('tdb', 'db', 'Postgres'),
      {
        id: 'e1', type: 'arrow',
        startBinding: { elementId: 'a' }, endBinding: { elementId: 'b' },
        boundElements: [{ id: 'te1', type: 'text' }],
      },
      boundText('te1', 'e1', 'HTTPS + JWT'),
      { id: 'e2', type: 'arrow', startBinding: { elementId: 'b' }, endBinding: { elementId: 'db' } },
    ];
    const out = sceneToText({ elements }, 'auth-flow');
    expect(out).toContain('<diagram name="auth-flow" nodes="3" edges="2">');
    expect(out).toContain('N1 rect "Client"');
    expect(out).toContain('N2 rect "API Gateway"');
    expect(out).toContain('N3 ellipse "Postgres"');
    expect(out).toContain('N1 -> N2 "HTTPS + JWT"');
    expect(out).toContain('N2 -> N3');
  });

  it('marks unbound endpoints, frames, free text; filters deleted', () => {
    const elements: SceneElement[] = [
      { id: 'f1', type: 'frame', name: 'Backend' },
      rect('a', { frameId: 'f1', boundElements: [{ id: 'ta', type: 'text' }] }),
      boundText('ta', 'a', 'Service'),
      { id: 'e1', type: 'arrow', startBinding: null, endBinding: { elementId: 'a' } },
      { id: 't1', type: 'text', text: 'v2 – draft', originalText: 'v2 – draft' },
      rect('gone', { isDeleted: true, boundElements: [{ id: 'tg', type: 'text' }] }),
      boundText('tg', 'gone', 'Deleted'),
    ];
    const out = sceneToText({ elements }, 'x');
    expect(out).toContain('N1 rect "Service" (frame: "Backend")');
    expect(out).toContain('(free) -> N1');
    expect(out).toContain('text: "v2 – draft"');
    expect(out).toContain('frame: "Backend"');
    expect(out).not.toContain('Deleted');
  });

  it('handles empty scenes and unlabeled nodes', () => {
    expect(sceneToText({ elements: [] }, 'empty')).toBe('<diagram name="empty" empty="true" />');
    const out = sceneToText({ elements: [rect('a')] }, 'x');
    expect(out).toContain('N1 rect (unlabeled)');
  });

  it('escapes quotes and collapses whitespace in labels', () => {
    const elements: SceneElement[] = [
      rect('a', { boundElements: [{ id: 'ta', type: 'text' }] }),
      boundText('ta', 'a', 'say "hi"\n  twice'),
    ];
    expect(sceneToText({ elements }, 'x')).toContain('N1 rect "say \\"hi\\" twice"');
  });
});
