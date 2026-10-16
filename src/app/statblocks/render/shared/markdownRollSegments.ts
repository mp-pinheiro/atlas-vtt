import MarkdownIt from 'markdown-it';
import { splitDiceSegments, type DiceSegment } from './diceSegments';

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false });
interface MarkdownToken { type: string; content: string; children: readonly MarkdownToken[] | null }

export function markdownRollSegments(text: string): readonly DiceSegment[] {
  const result: DiceSegment[] = [];
  const walk = (tokens: readonly MarkdownToken[]): void => {
    for (const token of tokens) {
      if (token.type === 'image' || token.type === 'code_inline' || token.type === 'code_block' || token.type === 'fence') continue;
      if (token.children) walk(token.children);
      else if (token.type === 'text') result.push(...splitDiceSegments(token.content));
    }
  };
  walk(markdown.parse(text, {}));
  return result;
}
