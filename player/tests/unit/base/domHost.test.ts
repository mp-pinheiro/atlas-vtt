import { afterEach, describe, expect, it } from 'vitest';
import { getDomHost } from '../../../../src/app/host/dom';
import { installPlayerDomHost, playerDomHost } from '../../../src/host/domHost';

describe('playerDomHost', () => {
  it('creates canvases, of the given size or the default', () => {
    expect(playerDomHost.createCanvas()).toBeInstanceOf(HTMLCanvasElement);
    const sized = playerDomHost.createCanvas(undefined, { width: 64, height: 32 });
    expect([sized.width, sized.height]).toEqual([64, 32]);
  });

  it('creates a canvas in the document it is asked for', () => {
    const other = document.implementation.createHTMLDocument('popout');
    expect(playerDomHost.createCanvas(other).ownerDocument).toBe(other);
    expect(playerDomHost.createCanvas().ownerDocument).toBe(document);
  });

  it('adds a div with a class to its parent', () => {
    const parent = document.createElement('section');
    const div = playerDomHost.createDiv(parent, 'atlas-example');
    expect(div.parentElement).toBe(parent);
    expect(div.className).toBe('atlas-example');
    expect(div.ownerDocument).toBe(document);
  });

  it('finds the window of an element and of a document', () => {
    expect(playerDomHost.ownerWindow(document.body)).toBe(window);
    expect(playerDomHost.ownerWindow(document)).toBe(window);
  });

  it('falls back to the page\'s window for a document that has none', () => {
    const detached = document.implementation.createHTMLDocument('detached');
    expect(playerDomHost.ownerWindow(detached.body)).toBe(window);
  });

  it('answers with the page\'s document', () => {
    expect(playerDomHost.activeDocument()).toBe(document);
  });
});

describe('installPlayerDomHost', () => {
  let restore: (() => void) | undefined;
  afterEach(() => restore?.());

  it('binds the host for shared code and gives the previous one back', () => {
    const before = getDomHost();
    restore = installPlayerDomHost();
    expect(getDomHost()).toBe(playerDomHost);
    restore();
    expect(getDomHost()).toBe(before);
    restore = undefined;
  });
});
