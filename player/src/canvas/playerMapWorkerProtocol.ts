import type { PixelRect, TileRef } from '../../../src/app/pixi/mapImage/pyramid.ts';

export type PlayerMapWorkerRequest =
  | { readonly type: 'open'; readonly generation: number; readonly bytes: ArrayBuffer; readonly originalWidth: number; readonly originalHeight: number; readonly byteHash: string }
  | { readonly type: 'tile'; readonly generation: number; readonly id: number; readonly ref: TileRef; readonly rect: PixelRect; readonly width: number; readonly height: number }
  | { readonly type: 'overview'; readonly generation: number; readonly id: number; readonly maxSide: number }
  | { readonly type: 'cancel'; readonly generation: number; readonly id: number }
  | { readonly type: 'close'; readonly generation: number };

export type PlayerMapWorkerResponse =
  | { readonly type: 'opened'; readonly generation: number; readonly width: number; readonly height: number; readonly decodedScale: number; readonly byteHash: string }
  | { readonly type: 'bitmap'; readonly generation: number; readonly id: number; readonly bitmap: ImageBitmap }
  | { readonly type: 'failed'; readonly generation: number; readonly id?: number; readonly message: string };
