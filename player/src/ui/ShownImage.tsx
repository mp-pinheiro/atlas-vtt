import { CloseButton } from '../../../src/app/packages/components/primitives/CloseButton.tsx';
import { useEffect, useState, type ReactElement } from 'react';
import type { ImageMessage } from '../../../src/app/online/protocol/image.ts';
import type { AssetDownloads } from '../state/interfaces.ts';
import { playerText } from '../i18n.ts';

export interface ShownImageProps {
  readonly message: ImageMessage | null;
  readonly assets: AssetDownloads;
  readonly onClose?: () => void;
}

export function ShownImage({ message, assets, onClose }: ShownImageProps): ReactElement | null {
  const shown = message?.shown ?? null;
  const [closedId, setClosedId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (shown === null) {
      setClosedId(null);
      setUnavailable(false);
    } else if (shown.id !== closedId) {
      setClosedId(null);
      setUnavailable(false);
    }
  }, [closedId, shown]);
  const visible = shown !== null && closedId !== shown.id;
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    let acquired = false;
    setImageUrl(null);
    if (!visible || shown === null) return () => { alive = false; };
    const maxSide = Math.max(256, Math.min(16384, Math.ceil(Math.max(window.innerWidth, window.innerHeight) * window.devicePixelRatio * 2)));
    void assets.request(shown.image, maxSide).then((blob) => {
      if (!alive) { assets.release(shown.image.hash, maxSide); return; }
      acquired = true;
      objectUrl = URL.createObjectURL(blob);
      setImageUrl(objectUrl);
    }).catch(() => {
      if (alive) setUnavailable(true);
    });
    return () => {
      alive = false;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
      if (acquired) assets.release(shown.image.hash, maxSide);
    };
  }, [assets, shown, visible]);
  if (!visible || shown === null) return null;
  return <div className="atlas-player__shown-image" role="dialog" aria-modal="true" aria-label={playerText('shownImage')}>
    <CloseButton className="atlas-player__shown-image-close" onClick={() => { setClosedId(shown.id); onClose?.(); }} aria-label={playerText('close')} />
    {imageUrl ? <img src={imageUrl} alt={playerText('shownImage')} style={{ aspectRatio: `${shown.width} / ${shown.height}` }} /> : unavailable ? <p role="status">{playerText('imageUnavailable')}</p> : <p role="status">{playerText('loading')}</p>}
  </div>;
}
