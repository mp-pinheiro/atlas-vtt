import type { LogReply } from '../protocol/index.ts';
import { useRef, type ReactElement } from 'react';
import { AuthorDisc, toneClass } from './AuthorDisc.tsx';
import { shownName } from './logAuthors.ts';
import { toRow, useKeepFocus } from './useKeepFocus.ts';
import { useAuthorColour } from './authorColours.ts';

/**
 * What a reply answers, above its byline: a small disc, the name and one line of the original,
 * joined to the row's avatar by a curved line. A click opens the thread, or within one leads to
 * the original; a quote that goes as the thread opens leaves the focus on its row.
 */
export function ReplyQuote({ reply, self, onOpen }: { readonly reply: LogReply; readonly self: string | null; readonly onOpen: () => void }): ReactElement {
  const quote = useRef<HTMLDivElement>(null);
  const colour = useAuthorColour(reply.who);
  useKeepFocus(quote, toRow);
  const who = (
    <>
      <AuthorDisc who={reply.who} name={reply.name} size="quote" />
      <span className={`atlas-online-log__quote-name ${toneClass(reply.who, colour)}`}>{shownName(reply.who, reply.name, self)}</span>
    </>
  );
  return (
    <div ref={quote} className="atlas-online-log__quote">
      {reply.gone === true ? (
        <span className="atlas-online-log__quote-line">
          {who}
          <span className="atlas-online-log__quote-text atlas-online-log__quote-text--gone">Message deleted</span>
        </span>
      ) : (
        <button type="button" className="atlas-online-log__quote-line" onClick={onOpen}>
          {who}
          <span className="atlas-online-log__quote-text">{reply.preview}</span>
        </button>
      )}
    </div>
  );
}
