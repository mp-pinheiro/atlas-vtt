import type { TokenGroupContainer } from './types';
import { TokenVisual } from './TokenVisual';

/** Keep full, unframed artwork proportional when a token is placed or resized. */
export function syncTokenArtwork(container: TokenGroupContainer, size: number): void {
  TokenVisual.artwork(container, size, container.tokenData?.showRing !== false);
}

/** Fits the artwork to the token again after its texture changed. */
export function fitTokenArtwork(container: TokenGroupContainer): void {
  const size = container.tokenSize;
  if (Number.isFinite(size) && size > 0) syncTokenArtwork(container, size);
}
