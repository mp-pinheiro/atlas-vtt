import React from 'react';
import type { App } from 'obsidian';
import type { SheetRenderHost } from './sheetRenderHost';
import { StatblockMarkdown } from './shared/PluginMarkdown';
import { diceLinkProps } from './shared/diceSegments';
import { linkedTokenArt, statblockImageSrc, statblockImageToken } from './shared/statblockImage';

export function pluginSheetHost(app: App | undefined, sourcePath: string | undefined): SheetRenderHost {
  return {
    markdown: (text, context) => <StatblockMarkdown text={text} app={app} sourcePath={sourcePath} dice={context.dice} />,
    image: (key) => statblockImageSrc(app, key, sourcePath) || (app ? linkedTokenArt(app, sourcePath)?.src ?? null : null),
    imageRing: (key) => {
      if (!app) return undefined;
      const own = statblockImageSrc(app, key, sourcePath);
      return (own ? statblockImageToken(app, key, sourcePath) : linkedTokenArt(app, sourcePath)?.token)?.showRing;
    },
    link: (label, href) => href ? <a href={href}>{label}</a> : label,
    roll: (_key, text, formula) => <span {...diceLinkProps(formula ?? text)}>{text}</span>,
  };
}
