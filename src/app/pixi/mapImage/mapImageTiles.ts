import { drawMissingAssetImage, MISSING_ASSET_SIZE } from '../../services/AssetValidationService';
import { fitWithin } from '../../imageProcessing/imageLayout';
import { pyramidOf, type TileRef } from './pyramid';
import type { OpenedPyramid, MapTiles, TileReader } from './mapTileTypes';


/** The tiles of a map image opened in the tile worker. */
export function decoderTiles(reader: TileReader, opened: OpenedPyramid): MapTiles {
  const { handle, hash, pyramid } = opened;
  return {
    source: { key: hash, pyramid, requestTile: (ref, signal) => reader.tile(handle, ref, signal) },
    cacheable: true,
    overview: (maxSide) => reader.overview(handle, maxSide),
    close: () => reader.close(handle),
  };
}

/** The key the placeholder's textures are held under; never kept once it is no longer shown. */
export const PLACEHOLDER_KEY = 'missing-map-image';

/**
 * The missing-image placeholder (a grey question mark) as a pyramid of one tile, drawn on this
 * thread from a canvas whenever a bitmap of it is asked for.
 */
export function placeholderTiles(): MapTiles {
  const pyramid = pyramidOf(MISSING_ASSET_SIZE, MISSING_ASSET_SIZE);
  const bitmap = async (size: { width: number; height: number }): Promise<ImageBitmap> => {
    const canvas = drawMissingAssetImage();
    if (!canvas) throw new Error('Could not draw the missing map image.');
    return createImageBitmap(canvas, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'medium' });
  };
  return {
    source: {
      key: PLACEHOLDER_KEY,
      pyramid,
      requestTile: (_ref, signal) => {
        signal.throwIfAborted();
        return bitmap(pyramid);
      },
    },
    cacheable: false,
    overview: (maxSide) => bitmap(fitWithin(pyramid, maxSide, maxSide)),
    close: () => undefined,
  };
}
