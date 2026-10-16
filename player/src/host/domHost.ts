import { installDomHost, type DomHost } from '../../../src/app/host/dom';

/** The document a node belongs to: the node itself for a document. */
function documentOf(node: Node): Document | null {
  return node.nodeType === Node.DOCUMENT_NODE ? (node as Document) : node.ownerDocument;
}

/** The DOM operations shared code asks of its host, over the page's own document. */
export const playerDomHost: DomHost = {
  createCanvas(doc = document, size): HTMLCanvasElement {
    const canvas = doc.createElement('canvas');
    if (size) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    return canvas;
  },
  createDiv(parent, cls): HTMLDivElement {
    const div = parent.ownerDocument.createElement('div');
    div.className = cls;
    parent.appendChild(div);
    return div;
  },
  ownerWindow(node): Window {
    return documentOf(node)?.defaultView ?? window;
  },
  activeDocument: (): Document => document,
};

/** Binds `playerDomHost` for shared code. Returns a function that restores the previous binding. */
export function installPlayerDomHost(): () => void {
  return installDomHost(playerDomHost);
}
