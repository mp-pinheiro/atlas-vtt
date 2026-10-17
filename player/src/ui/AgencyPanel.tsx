import { useEffect, useState, type ReactElement } from 'react';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { MAX_TOKEN_VALUE } from '../../../src/app/online/protocol/tokenUI.ts';
import { Button } from '../../../src/app/packages/components/primitives/button.tsx';
import type { PlayerState } from '../state/playerStore.ts';
import { playerText } from '../i18n.ts';

export function requestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let id = '';
  for (const byte of bytes) id += byte.toString(16).padStart(2, '0');
  return id;
}

export function AgencyPanel({ state, send }: { readonly state: PlayerState; readonly send: (message: PlayerMessage) => boolean }): ReactElement {
  const [claim, setClaim] = useState<{ readonly token: string; readonly request: string } | null>(null);
  useEffect(() => {
    setClaim(null);
  }, [state.generation]);
  const scene = state.scene;
  if (scene === null) return <div className="atlas-player__section atlas-player__agency"><p className="atlas-player__empty">{playerText('noActiveScene')}</p></div>;

  const tokens = scene.tokens?.tokens ?? null;
  const mine = scene.mine?.tokens ?? [];
  const disabled = !state.gmOnline || state.busy;
  let feedback: PlayerState['feedback'][number] | undefined;
  let lastRefusal: PlayerState['feedback'][number] | undefined;
  for (const entry of state.feedback) {
    if (entry.request === claim?.request && entry.scene === scene.scene.id) feedback = entry;
    if (entry.status === 'refused' && entry.scene === scene.scene.id) lastRefusal = entry;
  }
  const requestable = tokens?.filter((token) => token.claim === 'open') ?? [];
  const owned = tokens?.filter((token) => mine.includes(token.id)) ?? [];
  const conditionsAllowed = scene.agency?.permissions.playerConditions === true;

  return <div className="atlas-player__section atlas-player__agency">
    {conditionsAllowed && <section className="atlas-player__section atlas-player__agency-group">
      <h3>{playerText('conditions')}</h3>
      {tokens === null || scene.agency === null ? <p className="atlas-player__muted">{playerText('loading')}</p> : owned.length === 0
        ? <p className="atlas-player__empty">{playerText('noOwnedCharacters')}</p>
        : scene.agency.conditions.length === 0
          ? <p className="atlas-player__empty">{playerText('noSafeConditions')}</p>
          : owned.map((token) => {
            const name = token.name ?? playerText('unknownSpeaker');
            return <fieldset className="atlas-player__agency-character" key={token.id} disabled={disabled}>
              <legend>{name}</legend>
              <ul className="atlas-player__list atlas-player__agency-conditions">
                {scene.agency?.conditions.map((condition) => {
                  const value = scene.agency?.values[token.id]?.[condition.id] ?? 0;
                  return <li className="atlas-player__item atlas-player__agency-condition" role="group" aria-label={condition.name} key={condition.id}>
                    <span>{condition.name}</span>
                    {condition.valued ? <div className="atlas-player__agency-stepper">
                      <Button type="button" variant="outline" size="icon" aria-label={`− ${condition.name}`} disabled={disabled || value === 0} onClick={() => send({ t: 'condition', scene: scene.scene.id, id: token.id, condition: condition.id, value: value - 1 })}>−</Button>
                      <output aria-label={condition.name}>{value}</output>
                      <Button type="button" variant="outline" size="icon" aria-label={`+ ${condition.name}`} disabled={disabled || value === MAX_TOKEN_VALUE} onClick={() => send({ t: 'condition', scene: scene.scene.id, id: token.id, condition: condition.id, value: value + 1 })}>+</Button>
                    </div> : <input type="checkbox" aria-label={condition.name} checked={value > 0} onChange={(event) => send({ t: 'condition', scene: scene.scene.id, id: token.id, condition: condition.id, value: event.currentTarget.checked ? 1 : 0 })} />}
                  </li>;
                })}
              </ul>
            </fieldset>;
          })}
    </section>}
    <details className="atlas-player__agency-requests" open={owned.length === 0 || claim !== null}>
      <summary>{playerText('requestCharacter')} <span aria-hidden="true">{requestable.length}</span></summary>
      {tokens === null ? <p className="atlas-player__muted">{playerText('loading')}</p> : requestable.length === 0
        ? <p className="atlas-player__empty">{playerText('noRequestableCharacters')}</p>
        : <ul className="atlas-player__list atlas-player__agency-list">
          {requestable.map((token) => {
            const isPending = feedback?.status === 'pending' && claim?.token === token.id;
            return <li className="atlas-player__item atlas-player__agency-request" key={token.id}>
              <span>{token.name ?? playerText('unknownSpeaker')}</span>
              <Button type="button" variant="outline" size="sm" disabled={disabled || isPending} onClick={() => {
                const request = requestId();
                if (send({ t: 'claim-request', scene: scene.scene.id, id: token.id, request })) setClaim({ token: token.id, request });
              }}>{playerText('requestCharacter')}</Button>
            </li>;
          })}
        </ul>}
      {feedback && <p className="atlas-player__muted" role="status">{playerText(feedback.status)}</p>}
    </details>
    {scene.agency?.permissions.approval && <p className="atlas-player__muted">{playerText('approvalInstructions')}</p>}
    {lastRefusal && <p className="atlas-player__notice" key={lastRefusal.request} role="alert">{playerText('actionRefused')}</p>}
  </div>;
}
