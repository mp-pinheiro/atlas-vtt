import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { questEmbeds, readQuestText, type QuestImage } from '../../../src/app/online/protocol/questText.ts';
import type { AssetRef } from '../../../src/app/online/protocol/asset.ts';
import type { AssetDownloads } from '../state/interfaces.ts';
import { SafeMarkdown } from './SafeMarkdown.tsx';
import { playerText } from '../i18n.ts';

export interface BookTextReaderProps {
  readonly title: string;
  readonly opening: string;
  readonly text?: AssetRef;
  readonly images?: readonly QuestImage[];
  readonly assets: AssetDownloads;
}

interface ImageEmbed { readonly key: string; readonly image: AssetRef }
interface PreparedText { readonly text: string; readonly embeds: readonly ImageEmbed[] }
const EMPTY_IMAGES: readonly QuestImage[] = [];

function sizeFrom(value: string): { readonly width: number | null; readonly height: number | null } {
  const match = /^(\d{1,5})(?:x(\d{1,5}))?$/.exec(value.trim());
  const width = match?.[1] === undefined ? null : Number(match[1]);
  const height = match?.[2] === undefined ? null : Number(match[2]);
  return { width: width !== null && width > 0 ? width : null, height: height !== null && height > 0 ? height : null };
}

function prepareText(source: string, images: readonly QuestImage[]): PreparedText {
  const candidates = questEmbeds(source);
  const used = new Set<number>();
  const embeds: ImageEmbed[] = [];
  const marker = /!\[\[([^\]\n]+)\]\]|!\[([^\]\n]*)\]\(\s*(<[^<>\n]+>|[^\s()<>]+)(?:\s+"[^"\n]*")?\s*\)/g;
  const text = source.replace(marker, (whole, wiki: string | undefined, alt: string | undefined, markdownTarget: string | undefined) => {
    let target: string;
    let width: number | null;
    let height: number | null;
    let label: string;
    if (wiki !== undefined) {
      const parts = wiki.split('|');
      target = (parts[0] ?? '').trim();
      const size = sizeFrom(parts.at(-1) ?? '');
      width = parts.length > 1 ? size.width : null;
      height = parts.length > 1 ? size.height : null;
      label = target;
    } else {
      target = (markdownTarget ?? '').replace(/^<|>$/g, '');
      const sizeParts = (alt ?? '').split('|');
      const size = sizeFrom(sizeParts.at(-1) ?? '');
      width = sizeParts.length > 1 ? size.width : null;
      height = sizeParts.length > 1 ? size.height : null;
      label = sizeParts[0] ?? '';
    }
    const occurrence = candidates.findIndex((entry, index) => !used.has(index) && entry.target === target && entry.width === width && entry.height === height);
    if (occurrence < 0) return label || target || whole;
    used.add(occurrence);
    const image = images.find((entry) => entry.target === target && entry.width === width && entry.height === height);
    if (!image) return label || target;
    const key = `quest-image-${embeds.length}`;
    embeds.push({ key, image: image.image });
    return `![${label.replace(/[\]]/g, '')}](${key})`;
  });
  return { text, embeds };
}

export function BookTextReader({ title, opening, text: textRef, images = EMPTY_IMAGES, assets }: BookTextReaderProps): ReactElement {
  const [fullText, setFullText] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [imageUrls, setImageUrls] = useState<Readonly<Record<string, string>>>({});
  useEffect(() => {
    let alive = true;
    let acquired = false;
    setFullText(null);
    setUnavailable(false);
    if (textRef === undefined) return () => { alive = false; };
    void assets.request(textRef).then(async (blob) => {
      if (!alive) { assets.release(textRef.hash); return; }
      acquired = true;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!alive) return;
      const text = readQuestText(bytes);
      if (text === null) setUnavailable(true);
      else setFullText(text);
    }).catch(() => {
      if (alive) setUnavailable(true);
    });
    return () => {
      alive = false;
      if (acquired) assets.release(textRef.hash);
    };
  }, [assets, textRef]);
  const prepared = useMemo(() => prepareText(fullText ?? opening, images), [fullText, images, opening]);
  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    const acquired: string[] = [];
    setImageUrls({});
    void Promise.all(prepared.embeds.map(async (embed) => {
      const blob = await assets.request(embed.image);
      if (!alive) { assets.release(embed.image.hash); return [embed.key, ''] as const; }
      acquired.push(embed.image.hash);
      const url = URL.createObjectURL(blob);
      created.push(url);
      return [embed.key, url] as const;
    })).then((entries) => {
      if (alive) setImageUrls(Object.fromEntries(entries));
    }).catch(() => {
      if (alive) setUnavailable(true);
    });
    return () => {
      alive = false;
      for (const url of created) URL.revokeObjectURL(url);
      for (const hash of acquired) assets.release(hash);
    };
  }, [assets, prepared]);
  return <article className="atlas-player__book-document" aria-label={title} role="document">
    {unavailable && <p className="atlas-player__notice" role="status">{playerText('unavailable')}</p>}
    <SafeMarkdown text={prepared.text} images={imageUrls} />
  </article>;
}
