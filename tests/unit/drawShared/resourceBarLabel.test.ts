import { Text } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RESOURCE_NUMBER_GAP, RESOURCE_NUMBER_SCALE, RESOURCE_NUMBER_STYLE, ResourceBarLabel } from '../../../src/app/pixi/ResourceBarLabel';
import type { ResourceValue } from '../../../src/app/resources/resourceTypes';
import { stubJsdomGraphics } from '../../mocks/jsdomGraphics';

let restoreGraphics: () => void;
beforeEach(() => { restoreGraphics = stubJsdomGraphics(); });
afterEach(() => restoreGraphics());

/** The label's three texts: the current number, the slash and the maximum. */
function textsOf(label: ResourceBarLabel): [Text, Text, Text] {
  const [current, separator, maximum] = label.children as Text[];
  return [current!, separator!, maximum!];
}

function labelFor(run: (label: ResourceBarLabel) => void): void {
  const label = new ResourceBarLabel();
  try { run(label); } finally { label.destroy({ children: true }); }
}

describe('ResourceBarLabel', () => {
  it('writes the value the shared resource type describes: current, a slash and the maximum', () => {
    const value: ResourceValue = { current: 7, max: 12 };
    labelFor((label) => {
      label.setValue(value);
      const [current, separator, maximum] = textsOf(label);
      expect([current.text, separator.text, maximum.text]).toEqual(['7', '/', '12']);
      expect([current.visible, separator.visible, maximum.visible]).toEqual([true, true, true]);
      expect([current.anchor.x, current.position.x]).toEqual([1, -RESOURCE_NUMBER_GAP]);
    });
  });

  it('writes a value that does not count as one centred number', () => {
    labelFor((label) => {
      label.setValue({ current: 2, max: 9 });
      label.setFixed(15);
      const [current, separator, maximum] = textsOf(label);
      expect(current.text).toBe('15');
      expect([separator.visible, maximum.visible]).toEqual([false, false]);
      expect([current.anchor.x, current.position.x]).toEqual([0.5, 0]);
    });
  });

  it('goes back to current and maximum after a fixed number', () => {
    labelFor((label) => {
      label.setFixed(15);
      label.setValue({ current: 3, max: 4 });
      const [current, separator, maximum] = textsOf(label);
      expect([current.text, maximum.text]).toEqual(['3', '4']);
      expect([separator.visible, maximum.visible]).toEqual([true, true]);
      expect([current.anchor.x, current.position.x]).toEqual([1, -RESOURCE_NUMBER_GAP]);
    });
  });

  it('draws its numbers large and scaled down, in the style every resource shares', () => {
    labelFor((label) => {
      for (const text of textsOf(label)) {
        expect(text.scale.x).toBe(RESOURCE_NUMBER_SCALE);
        expect(text.resolution).toBe(3);
        expect(text.style.fontSize).toBe(RESOURCE_NUMBER_STYLE.fontSize);
      }
    });
  });

  it('changes the resolution of its numbers only when it differs', () => {
    labelFor((label) => {
      label.setResolution(2);
      expect(textsOf(label).map((text) => text.resolution)).toEqual([2, 2, 2]);
      label.setResolution(2);
      expect(textsOf(label).map((text) => text.resolution)).toEqual([2, 2, 2]);
    });
  });
});
