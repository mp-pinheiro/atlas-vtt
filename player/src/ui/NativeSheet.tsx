import { Fragment, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import type { SharedSheet } from '../../../src/app/online/protocol/sheet.ts';
import type { SheetResource } from '../../../src/app/online/protocol/bookCharacter.ts';
import { ROLL_MODES, type RollMode } from '../../../src/app/online/protocol/chat.ts';
import { StatblockSheetCore } from '../../../src/app/statblocks/render/StatblockSheetCore.tsx';
import { sharedSheetTemplate } from '../../../src/app/statblocks/render/sharedSheetTemplate.ts';
import type { SheetRenderHost } from '../../../src/app/statblocks/render/sheetRenderHost.tsx';
import { sheetRollKey, splitDiceSegments, type SheetValuePath } from '../../../src/app/statblocks/render/shared/diceSegments.ts';
import type { AssetDownloads } from '../state/interfaces.ts';
import { SafeMarkdown } from './SafeMarkdown.tsx';
import { playerText } from '../i18n.ts';

function RollButton({ text, label, index, onRoll }: { readonly text: string; readonly label: string; readonly index: number; readonly onRoll: (index: number, mode: RollMode) => boolean }): ReactElement {
  const [open, setOpen] = useState(false);
  return <span className="atlas-player__sheet-roll"><button type="button" aria-label={label} aria-expanded={open} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRoll(index, 'public'); }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setOpen((current) => !current); }}>{text}</button><button type="button" aria-label={playerText('rollModes')} aria-expanded={open} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen((current) => !current); }}>▾</button>{open && <span role="group" aria-label={playerText('rollModes')}>{ROLL_MODES.map((mode) => <button key={mode} type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (onRoll(index, mode)) setOpen(false); }}>{playerText(mode)}</button>)}</span>}</span>;
}

export function NativeSheet({ sheet, assets, onRoll, resources }: { readonly sheet: SharedSheet; readonly assets: AssetDownloads; readonly onRoll: (index: number, mode: RollMode) => boolean; readonly resources: readonly SheetResource[] }): ReactElement {
  const normalized = useMemo(() => sharedSheetTemplate(sheet.template), [sheet.template]);
  const descriptors = useMemo(() => new Map(sheet.rolls.map((roll) => [roll.key, roll])), [sheet.rolls]);
  const [urls, setUrls] = useState<Readonly<Record<string, string>>>({});
  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    const acquired: string[] = [];
    setUrls({});
    void Promise.all(Object.entries(sheet.images).map(async ([key, ref]) => {
      try {
        const blob = await assets.request(ref);
        if (!alive) { assets.release(ref.hash); return [key, ''] as const; }
        acquired.push(ref.hash);
        const url = URL.createObjectURL(blob);
        created.push(url);
        return [key, url] as const;
      } catch { return [key, ''] as const; }
    })).then((entries) => { if (alive) setUrls(Object.fromEntries(entries)); });
    return () => { alive = false; for (const url of created) URL.revokeObjectURL(url); for (const hash of acquired) assets.release(hash); };
  }, [assets, sheet.images]);
  const roll = (key: string, text: string): ReactNode => {
    const descriptor = descriptors.get(key);
    return descriptor === undefined ? <span className="atlas-player__projection-error" aria-label={playerText('sheetUnavailable')}>{text}</span> : <RollButton key={key} index={descriptor.index} label={descriptor.label} text={text} onRoll={onRoll} />;
  };
  const host: SheetRenderHost = {
    image: (key) => urls[key] || null,
    link: (label, href) => {
      let url: URL | null = null;
      try { if (href !== null) url = new URL(href); } catch { url = null; }
      return url !== null && (url.protocol === 'https:' || url.protocol === 'http:') ? <a href={url.href} target="_blank" rel="noopener noreferrer">{label}</a> : <span>{label}</span>;
    },
    roll,
    markdown: (text, context) => {
      let ordinal = 0;
      let location: [string, SheetValuePath] | null = null;
      try {
        const parsed: unknown = JSON.parse(context.key);
        if (Array.isArray(parsed) && typeof parsed[0] === 'string' && Array.isArray(parsed[1]) && parsed[1].every((entry: unknown) => typeof entry === 'string' || typeof entry === 'number')) location = [parsed[0], parsed[1]];
      } catch { location = null; }
      const renderText = context.dice === false || location === null ? undefined : (value: string): ReactNode => splitDiceSegments(value).map((segment, index) => <Fragment key={index}>{segment.dice ? roll(sheetRollKey(location[0], location[1], ordinal++), segment.text) : segment.text}</Fragment>);
      return <SafeMarkdown text={text} images={urls} renderText={renderText} inline={context.inline} />;
    },
  };
  const token = useMemo(() => ({ id: sheet.revision, name: sheet.name, imagePath: '', resources: Object.fromEntries(resources.flatMap((resource) => resource.key === null ? [] : [[resource.key, { current: resource.current, max: resource.max }]])) }), [resources, sheet.revision, sheet.name]);
  const source = sheet.template.source;
  const attribution = source === undefined ? null : <footer className="atlas-player__sheet-attribution"><p>{host.link(source.label, source.licenceUrl)}</p><p>{source.attribution}</p><p>{source.modification}</p>{source.trademarkNotice && <p>{source.trademarkNotice}</p>}</footer>;
  return <StatblockSheetCore {...normalized} name={sheet.name} fields={sheet.fields} variant="full" host={host} token={token} footer={attribution} />;
}
