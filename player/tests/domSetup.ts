import { createRequire } from 'node:module';
interface TestWindow extends Window { close(): void; HTMLCanvasElement: typeof HTMLCanvasElement }
interface TestDom { readonly window: TestWindow }
interface TestJSDomModule { readonly JSDOM: new (html: string, options: { readonly url: string }) => TestDom }
const { JSDOM } = createRequire(import.meta.url)('jsdom') as TestJSDomModule;
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://player.test' });
const canvasContext = {
  fillStyle: '',
  globalCompositeOperation: '',
  fillRect() {},
  drawImage() {},
  getImageData() { return { data: new Uint8ClampedArray([255, 0, 0, 255]) }; },
};
Object.defineProperty(dom.window.HTMLCanvasElement.prototype, 'getContext', { configurable: true, value: () => canvasContext });

class TestResizeObserver implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  observe(_target: Element, _options?: ResizeObserverOptions): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
}
Object.defineProperty(dom.window, 'ResizeObserver', { configurable: true, value: TestResizeObserver });
const names = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MouseEvent', 'KeyboardEvent', 'ResizeObserver'] as const;
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const name of names) {
  previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value: (dom.window as unknown as Record<string, unknown>)[name] });
}
dom.window.matchMedia = (query: string) => ({
  matches: false, media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: (_event: Event) => false,
});

export function closeDom(): void {
  dom.window.close();
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
}
