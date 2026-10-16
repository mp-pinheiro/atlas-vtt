import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import type { ReactElement, ReactNode } from 'react';

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });

export interface SafeMarkdownProps {
  readonly text: string;
  readonly images?: Readonly<Record<string, string>>;
  readonly renderText?: (text: string) => ReactNode;
  readonly inline?: boolean;
}

function safeHref(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function inline(tokens: readonly Token[], images: Readonly<Record<string, string>>, keyPrefix: string, renderText?: (text: string) => ReactNode): ReactNode[] {
  const nodes: ReactNode[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const key = `${keyPrefix}:${index}`;
    if (token.type === 'text' || token.type === 'code_inline') {
      nodes.push(token.type === 'code_inline' ? <code key={key}>{token.content}</code> : renderText ? renderText(token.content) : token.content);
    } else if (token.type === 'softbreak' || token.type === 'hardbreak') {
      nodes.push(<br key={key} />);
    } else if (token.type === 'image') {
      const source = token.attrGet('src');
      const resolved = typeof source === 'string' && Object.hasOwn(images, source) ? images[source] : undefined;
      if (resolved) nodes.push(<img key={key} src={resolved} alt={token.content} loading="lazy" />);
      else nodes.push(token.content);
    } else if (token.nesting === 1 && ['strong', 'em', 's', 'link'].includes(token.type.replace(/_(open|close)$/, ''))) {
      const closeType = token.type.replace('_open', '_close');
      let depth = 1;
      let end = index + 1;
      for (; end < tokens.length; end += 1) {
        if (tokens[end]?.type === token.type) depth += 1;
        if (tokens[end]?.type === closeType) {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      const tag = token.type === 'link_open' ? 'a' : token.type.split('_')[0];
      const children = inline(tokens.slice(index + 1, end), images, key, renderText);
      if (tag === 'a') {
        const href = token.attrGet('href');
        const valid = href === null ? null : safeHref(href);
        nodes.push(valid === null ? <span key={key}>{children}</span> : <a key={key} href={valid} target="_blank" rel="noopener noreferrer">{children}</a>);
      } else if (tag === 'strong') nodes.push(<strong key={key}>{children}</strong>);
      else if (tag === 'em') nodes.push(<em key={key}>{children}</em>);
      else if (tag === 's') nodes.push(<del key={key}>{children}</del>);
      index = end;
    } else if (token.type === 'html_inline') {
      nodes.push(token.content);
    }
  }
  return nodes;
}

function blockEnd(tokens: readonly Token[], start: number, type: string): number {
  let nesting = 1;
  for (let index = start + 1; index < tokens.length; index += 1) {
    if (tokens[index]?.type === type) nesting += 1;
    if (tokens[index]?.type === type.replace('_open', '_close')) {
      nesting -= 1;
      if (nesting === 0) return index;
    }
  }
  return tokens.length;
}

function blocks(tokens: readonly Token[], images: Readonly<Record<string, string>>, prefix: string, renderText?: (text: string) => ReactNode): ReactNode[] {
  const nodes: ReactNode[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const key = `${prefix}:${index}`;
    if (token.type === 'paragraph_open' || token.type === 'heading_open') {
      const content = tokens[index + 1];
      const close = tokens[index + 2];
      const tag = token.type === 'paragraph_open' ? 'p' : token.tag;
      const children = content?.type === 'inline' ? inline(content.children ?? [], images, key, renderText) : [];
      if (tag === 'p') nodes.push(<p key={key}>{children}</p>);
      else if (tag === 'h1') nodes.push(<h1 key={key}>{children}</h1>);
      else if (tag === 'h2') nodes.push(<h2 key={key}>{children}</h2>);
      else if (tag === 'h3') nodes.push(<h3 key={key}>{children}</h3>);
      else if (tag === 'h4') nodes.push(<h4 key={key}>{children}</h4>);
      else if (tag === 'h5') nodes.push(<h5 key={key}>{children}</h5>);
      else if (tag === 'h6') nodes.push(<h6 key={key}>{children}</h6>);
      index += close?.type.endsWith('_close') ? 2 : 1;
    } else if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open' || token.type === 'blockquote_open') {
      const end = blockEnd(tokens, index, token.type);
      const inner = blocks(tokens.slice(index + 1, end), images, key, renderText);
      nodes.push(token.type === 'bullet_list_open' ? <ul key={key}>{inner}</ul> : token.type === 'ordered_list_open' ? <ol key={key}>{inner}</ol> : <blockquote key={key}>{inner}</blockquote>);
      index = end;
    } else if (token.type === 'list_item_open') {
      const end = blockEnd(tokens, index, token.type);
      nodes.push(<li key={key}>{blocks(tokens.slice(index + 1, end), images, key, renderText)}</li>);
      index = end;
    } else if (['table_open', 'thead_open', 'tbody_open', 'tr_open', 'th_open', 'td_open'].includes(token.type)) {
      const end = blockEnd(tokens, index, token.type);
      const children = blocks(tokens.slice(index + 1, end), images, key, renderText);
      if (token.type === 'table_open') nodes.push(<table key={key}>{children}</table>);
      else if (token.type === 'thead_open') nodes.push(<thead key={key}>{children}</thead>);
      else if (token.type === 'tbody_open') nodes.push(<tbody key={key}>{children}</tbody>);
      else if (token.type === 'tr_open') nodes.push(<tr key={key}>{children}</tr>);
      else if (token.type === 'th_open') nodes.push(<th key={key}>{children}</th>);
      else nodes.push(<td key={key}>{children}</td>);
      index = end;
    } else if (token.type === 'inline') {
      nodes.push(...inline(token.children ?? [], images, key, renderText));
    } else if (token.type === 'fence' || token.type === 'code_block') {
      nodes.push(<pre key={key}><code>{token.content}</code></pre>);
    } else if (token.type === 'hr') {
      nodes.push(<hr key={key} />);
    } else if (token.type === 'html_block') {
      nodes.push(<p key={key}>{token.content}</p>);
    }
  }
  return nodes;
}

export function SafeMarkdown({ text, images = {}, renderText, inline: inlineOnly = false }: SafeMarkdownProps): ReactElement {
  if (inlineOnly) return <span className="atlas-player__markdown">{inline(markdown.parseInline(text, {})[0]?.children ?? [], images, 'md', renderText)}</span>;
  const tokens = markdown.parse(text, {});
  return <div className="atlas-player__markdown">{blocks(tokens, images, 'md', renderText)}</div>;
}
