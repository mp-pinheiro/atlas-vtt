import { installDomHost } from '../../src/app/host/dom.ts';
import { setLocale } from '../../src/app/i18n/index.ts';

setLocale(navigator.language);

installDomHost({
  createCanvas(doc = document, size): HTMLCanvasElement {
    const canvas = doc.createElement('canvas');
    if (size) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    return canvas;
  },
  createDiv(parent, cls): HTMLDivElement {
    const element = parent.ownerDocument.createElement('div');
    element.className = cls;
    parent.append(element);
    return element;
  },
  ownerWindow(node): Window {
    const owner = node.ownerDocument?.defaultView;
    if (owner === null || owner === undefined) throw new Error('DOM node has no owning window');
    return owner;
  },
  activeDocument(): Document {
    return document;
  },
});
