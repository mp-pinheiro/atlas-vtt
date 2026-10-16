import { useEffect, useState, type ReactElement } from 'react';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { MAX_TOKEN_VALUE } from '../../../src/app/online/protocol/tokenUI.ts';
import type { PlayerState } from '../state/playerStore.ts';
import { playerText } from '../i18n.ts';

export function requestId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function AgencyPanel({ state, send }: { readonly state: PlayerState; readonly send: (message: PlayerMessage) => boolean }): ReactElement | null {
  const [claim, setClaim] = useState<{ readonly token: string; readonly request: string } | null>(null);
  useEffect(() => setClaim(null), [state.generation]);
  const scene = state.scene;
  if (scene === null) return null;
  const mine = scene.mine?.tokens ?? [];
  const disabled = !state.gmOnline || state.busy;
  const feedback = state.feedback.find((entry) => entry.request === claim?.request);
  return <section className="atlas-player__surface">
    <h2>{playerText('characters')}</h2>
    {scene.tokens?.tokens.filter((token) => token.claim === 'open').map((token) => <div className="atlas-player__row" key={token.id}><span>{token.name ?? playerText('unknownSpeaker')}</span><button type="button" disabled={disabled || feedback?.status === 'pending'} onClick={() => {
      const request = requestId();
      if (send({ t: 'claim-request', scene: scene.scene.id, id: token.id, request })) setClaim({ token: token.id, request });
    }}>{playerText('requestCharacter')}</button></div>)}
    {feedback && <p role="status">{playerText(feedback.status)}</p>}
    {scene.agency?.permissions.playerConditions && scene.tokens?.tokens.filter((token) => mine.includes(token.id)).map((token) => <fieldset key={token.id} disabled={disabled}><legend>{token.name ?? playerText('unknownSpeaker')}</legend>{scene.agency?.conditions.map((condition) => {
      const value = scene.agency?.values[token.id]?.[condition.id] ?? 0;
      return <div className="atlas-player__row" role="group" aria-label={condition.name} key={condition.id}><span>{condition.name}</span>{condition.valued ? <><button type="button" disabled={disabled || value === 0} onClick={() => send({ t: 'condition', scene: scene.scene.id, id: token.id, condition: condition.id, value: value - 1 })}>−</button><output>{value}</output><button type="button" disabled={disabled || value === MAX_TOKEN_VALUE} onClick={() => send({ t: 'condition', scene: scene.scene.id, id: token.id, condition: condition.id, value: value + 1 })}>+</button></> : <input type="checkbox" aria-label={condition.name} checked={value > 0} onChange={(event) => send({ t: 'condition', scene: scene.scene.id, id: token.id, condition: condition.id, value: event.currentTarget.checked ? 1 : 0 })} />}</div>;
    })}</fieldset>)}
    {scene.agency?.permissions.approval && <p>{playerText('approvalInstructions')}</p>}
    {state.feedback.filter((entry) => entry.status === 'refused').slice(-1).map((entry) => <p key={entry.request} role="alert">{playerText('actionRefused')}</p>)}
  </section>;
}
