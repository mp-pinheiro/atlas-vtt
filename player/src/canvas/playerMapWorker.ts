import { pyramidOf, type Pyramid } from '../../../src/app/pixi/mapImage/pyramid.ts';
import type { PlayerMapWorkerRequest, PlayerMapWorkerResponse } from './playerMapWorkerProtocol.ts';

const scope = self as unknown as Worker;
let generation = 0;
let pyramid: Pyramid | null = null;
let levels: ImageBitmap[] = [];
const cancelled = new Set<number>();

function send(message: PlayerMapWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(message, { transfer });
}

function clear(): void {
  for (const bitmap of levels) bitmap.close();
  levels = [];
  pyramid = null;
  cancelled.clear();
}

async function open(message: Extract<PlayerMapWorkerRequest, { type: 'open' }>): Promise<void> {
  clear();
  generation = message.generation;
  const decoded = await createImageBitmap(new Blob([message.bytes]));
  if (message.generation !== generation) {
    decoded.close();
    return;
  }
  const decodedScale = Math.max(1, message.originalWidth / decoded.width, message.originalHeight / decoded.height);
  const geometry = pyramidOf(message.originalWidth, message.originalHeight, decodedScale);
  const base = geometry.levels[0];
  if (!base) throw new Error('The map image pyramid has no base level.');
  const normalizedCanvas = new OffscreenCanvas(base.width, base.height);
  const normalizedContext = normalizedCanvas.getContext('2d');
  if (!normalizedContext) throw new Error('Could not create the map image canvas.');
  normalizedContext.imageSmoothingEnabled = true;
  normalizedContext.imageSmoothingQuality = 'high';
  normalizedContext.drawImage(decoded, 0, 0, base.width, base.height);
  decoded.close();
  levels.push(await createImageBitmap(normalizedCanvas));
  for (let index = 1; index < geometry.levels.length; index++) {
    const prior = levels[index - 1];
    const size = geometry.levels[index];
    if (!prior || !size) throw new Error('The image pyramid is incomplete.');
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the map image canvas.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(prior, 0, 0, size.width, size.height);
    levels.push(await createImageBitmap(canvas));
  }
  if (message.generation !== generation) {
    clear();
    return;
  }
  pyramid = geometry;
  send({ type: 'opened', generation, width: base.width, height: base.height, decodedScale, byteHash: message.byteHash });
}

async function answer(message: Extract<PlayerMapWorkerRequest, { type: 'tile' | 'overview' }>): Promise<void> {
  const map = pyramid;
  if (message.generation !== generation || !map) throw new Error('The map image is closed.');
  const bitmap = message.type === 'tile'
    ? await crop(message.ref.level, message.rect, message.width, message.height)
    : await overview(message.maxSide);
  if (message.generation !== generation || cancelled.delete(message.id) || !bitmap) {
    bitmap?.close();
    return;
  }
  send({ type: 'bitmap', generation, id: message.id, bitmap }, [bitmap]);
}

async function crop(level: number, rect: { x: number; y: number; width: number; height: number }, width: number, height: number): Promise<ImageBitmap | null> {
  const source = levels[level];
  if (!source) throw new Error('The map tile level is unavailable.');
  return createImageBitmap(source, rect.x, rect.y, rect.width, rect.height, { resizeWidth: width, resizeHeight: height });
}

async function overview(maxSide: number): Promise<ImageBitmap | null> {
  const map = pyramid;
  if (!map) return null;
  const level = map.levels.find(candidate => Math.max(candidate.width, candidate.height) <= maxSide) ?? map.levels[map.levels.length - 1];
  if (!level) return null;
  const source = levels[level.index];
  if (!source) return null;
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  if (scale === 1) return createImageBitmap(source);
  const width = Math.max(1, Math.floor(source.width * scale));
  const height = Math.max(1, Math.floor(source.height * scale));
  return createImageBitmap(source, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
}

scope.addEventListener('message', (event: MessageEvent<PlayerMapWorkerRequest>) => {
  const message = event.data;
  if (message.type === 'open') {
    void open(message).catch(error => send({ type: 'failed', generation: message.generation, message: error instanceof Error ? error.message : String(error) }));
  } else if (message.type === 'close') {
    if (message.generation === generation) { ++generation; clear(); }
  } else if (message.type === 'cancel') {
    if (message.generation === generation) cancelled.add(message.id);
  } else {
    void answer(message).catch(error => send({ type: 'failed', generation: message.generation, id: message.id, message: error instanceof Error ? error.message : String(error) }));
  }
});
