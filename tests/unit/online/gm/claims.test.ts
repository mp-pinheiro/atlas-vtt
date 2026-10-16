import { describe, expect, it } from 'vitest';
import { ClaimRequests, type ClaimRequest } from '../../../../src/app/online/gm/claims.ts';
import { Ownership, readOwnership } from '../../../../src/app/online/gm/ownership.ts';
import { publishEntry, sendLog } from '../../../../src/app/online/gm/log/logFanout.ts';
import { readSavedLog, sharedEntry, viewOf, type GmLogEntry } from '../../../../src/app/online/gm/log/logEntries.ts';
import { playerTone, type GmMessage } from '../../../../src/app/online/protocol/index.ts';
import { token } from './shareHarness.ts';

const alice = 'a'.repeat(20);
const bob = 'b'.repeat(20);
const request: ClaimRequest = { t: 'claim-request', scene: 'scene', id: 'a'.repeat(24), request: '1'.repeat(24) };

function harness(): { owners: Ownership; claims: ClaimRequests; frames: unknown[]; actions: unknown[]; setShown(value: boolean): void } {
  const owners = new Ownership(readOwnership(undefined), () => undefined);
  owners.welcome([{ id: alice, name: 'Alice' }, { id: bob, name: 'Bob' }]);
  const tokens = { hero: token('hero', { side: 'players' }) };
  const frames: unknown[] = [];
  const actions: unknown[] = [];
  let shown = true;
  const claims = new ClaimRequests({
    ownership: owners,
    current: () => ({ scene: 'scene', mapPath: 'map', tokens, tokenId: () => 'hero', shown: () => shown }),
    give: (id, from) => owners.give([id], tokens, from),
    send: (body, to) => frames.push([to, body]),
    log: { action: (...args) => { actions.push(args); return true; } },
  });
  return { owners, claims, frames, actions, setShown: (value) => { shown = value; } };
}

describe('player claims and permissions', () => {
  it('rechecks visibility on acceptance and never assigns automatically', () => {
    const h = harness();
    h.claims.receive(alice, request);
    expect(h.owners.ownerOf('hero', undefined)).toBeUndefined();
    h.setShown(false);
    h.claims.accept(alice, request.request);
    expect(h.claims.entries()).toEqual([]);
    expect(h.owners.ownerOf('hero', undefined)).toBeUndefined();
    h.claims.stop();
  });
  it('notifies the requester and assigns an eligible token only after acceptance', () => {
    const h = harness();
    h.claims.receive(alice, request);
    expect(h.frames).toContainEqual([alice, { t: 'claim-result', scene: 'scene', id: request.id, request: request.request, status: 'pending' }]);
    expect(h.owners.ownerOf('hero', undefined)).toBeUndefined();
    h.claims.accept(alice, request.request);
    expect(h.owners.ownerOf('hero', undefined)).toBe(alice);
    expect(h.frames).toContainEqual([alice, { t: 'claim-result', scene: 'scene', id: request.id, request: request.request, status: 'accepted' }]);
    expect(h.claims.entries()).toEqual([]);
    h.claims.stop();
  });

  it('accepts one competitor and cancels the rest; duplicate receipt is inert', () => {
    const h = harness();
    h.claims.receive(alice, request);
    h.claims.receive(alice, request);
    h.claims.receive(bob, { ...request, request: '2'.repeat(24) });
    expect(h.actions).toHaveLength(2);
    h.claims.accept(alice, request.request);
    expect(h.owners.ownerOf('hero', undefined)).toBe(alice);
    expect(h.claims.entries()).toEqual([]);
    expect(h.frames).toContainEqual([bob, { t: 'claim-result', scene: 'scene', id: request.id, request: '2'.repeat(24), status: 'cancelled' }]);
    h.claims.stop();
  });
  it('keeps map permissions and memory across rename/reset, not colours', () => {
    const h = harness();
    expect(h.owners.permissionsFor('map')).toEqual({ approval: false, perPlayerVision: false, playerConditions: false, playerDoors: false });
    h.owners.setPermission('map', 'approval', true);
    h.owners.setPermission('map', 'playerDoors', false);
    h.owners.setColour(alice, 6);
    expect(playerTone(alice, h.owners.colourOf(alice))).toBe(6);
    const id = h.owners.memoryIdFor('map');
    h.owners.renameMap('map', 'renamed');
    h.owners.reset();
    expect(h.owners.memoryIdFor('renamed')).toBe(id);
    expect(h.owners.toData().permissions).toEqual({ renamed: { approval: true } });
    expect(h.owners.colourOf(alice)).toBeUndefined();
    h.claims.stop();
  });
});

it('keeps private action audience through disk and every fanout without serializing it', () => {
  const entry: GmLogEntry = { id: '1'.repeat(24), at: 1, who: 'gm', name: 'GM', kind: 'action', action: 'claim-request', player: 'Alice', combatant: 'Hero', count: null, audience: [alice] };
  const restored = readSavedLog({ entries: [entry], present: [alice, bob] }).entries[0]!;
  expect(viewOf(restored, bob)).toBeNull();
  expect(viewOf(restored, alice)).toEqual(sharedEntry(entry));
  expect(viewOf(restored, 'gm')).toEqual(sharedEntry(entry));
  expect(sharedEntry(entry)).not.toHaveProperty('audience');
  const frames: { body: GmMessage; to?: string }[] = [];
  const send = (body: GmMessage, to?: string): void => { frames.push({ body, to }); };
  publishEntry(send, [alice, bob], restored);
  sendLog(send, [alice, bob], [restored], 10000);
  expect(frames.filter((frame) => frame.body.t === 'log-entry').map((frame) => frame.to)).toEqual([alice]);
  expect(frames.find((frame) => frame.to === bob)?.body).toEqual({ t: 'log', entries: [] });
  expect(JSON.stringify(frames)).not.toContain('audience');
});
