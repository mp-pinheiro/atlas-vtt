import { describe, expect, it } from 'vitest';
import { resolveMeasurementSettings } from '../../../../src/app/grid/measurementFormat';
import { RecipientPicture, type RecipientView } from '../../../../src/app/online/gm/RecipientPicture';
import { RecipientShare, type RecipientSnapshot, type RecipientValidity } from '../../../../src/app/online/gm/RecipientShare';
import { AssetAnswers } from '../../../../src/app/online/gm/assetAnswers';
import { sha256Hex } from '../../../../src/app/online/gm/assetServe';
import { sharedSight } from '../../../../src/app/online/gm/sceneInputs';
import { sharedRules } from '../../../../src/app/online/gm/RulesShare';
import type { SceneState } from '../../../../src/app/online/gm/atlasView';
import { DeltaReader, parseGmMessage, type GmMessage, type PicturePacket } from '../../../../src/app/online/protocol';
import { GENERIC_SIGHT_RULES } from '../../../../src/app/vision/sightRules';
import { PLAYER_SIGHT_POLICY, ownerSightPolicy } from '../../../../src/app/vision/tokenSightPolicy';
import { sceneState, token } from './shareHarness';

const grid = { type: 'square' as const, size: 70, offsetX: 0, offsetY: 0, enabled: true, opacity: 1 };
const measurement = resolveMeasurementSettings(undefined, grid);
const owner = (entry: { id: string }): string | undefined => entry.id === 'alice' ? 'alice-player' : entry.id === 'bob' ? 'bob-player' : undefined;
const initial = (): SceneState => sceneState({ grid, lighting: { enabled: true, ambient: 1 }, objects: {
  tokens: {
    alice: token('alice', { x: 100, y: 100, vision: { enabled: true, range: 10 } }),
    bob: token('bob', { x: 800, y: 100, vision: { enabled: true, range: 10 } }),
    aliceNpc: token('aliceNpc', { x: 130, y: 120 }),
    bobNpc: token('bobNpc', { x: 830, y: 120, light: { bright: 5, dim: 10, color: '#ffffff', intensity: 1, animation: 'none' } }),
    hidden: token('hidden', { x: 110, y: 110, isHidden: true, vision: { enabled: true }, light: { bright: 5, dim: 10, color: '#ffffff', intensity: 1, animation: 'none' } }),
  }, walls: {}, fog: {}, lights: {}, pins: {}, drawings: {}, texts: {}, audios: {},
} });

function picture(state: SceneState, player: string): RecipientView {
  const model = new RecipientPicture();
  model.update(state, { bounds: { width: 1400, height: 800 }, rules: GENERIC_SIGHT_RULES, measurement });
  const view = model.project(player, owner);
  if (view === null) throw new Error('missing picture');
  return view;
}

function snapshot(view: RecipientView): RecipientSnapshot {
  const rules = sharedRules(view.state.grid, measurement, '#ffffff');
  if (rules === null) throw new Error('missing rules');
  return { view, rules, grid: null, tokenRules: { resources: [], conditions: [] }, showNames: true, initiative: null, initiativeArt: new Map(), ownerOf: owner,
    claimOf: () => null, foundPin: () => null,
    agency: scene => ({ t: 'agency', scene, permissions: { approval: false, perPlayerVision: true, playerConditions: false, playerDoors: false }, conditions: [], values: {} }),
  };
}

function recipient(player: string): { share: RecipientShare; sent: { body: GmMessage; validity: RecipientValidity }[] } {
  let next = 0;
  const sent: { body: GmMessage; validity: RecipientValidity }[] = [];
  const share = new RecipientShare(player, { now: () => 100, randomId: () => (++next).toString(16).padStart(24, '0'), readImage: async () => null,
    changed: () => undefined, send: (body, _to, validity) => sent.push({ body, validity }),
  });
  share.setScene({ id: `scene-${player}`, map: null, lit: true, personal: true, memoryId: 'a'.repeat(24) });
  return { share, sent };
}

function packets(sent: readonly { body: GmMessage }[]): PicturePacket[] {
  return sent.flatMap(({ body }) => body.t === 'picture' ? [body] : []);
}

describe('recipient pictures', () => {
  it('restricts source selection but preserves the existing always-seen PCs', () => {
    const state = initial();
    const policy = ownerSightPolicy('alice-player', owner);
    expect(policy.alwaysSeen).toBe(PLAYER_SIGHT_POLICY.alwaysSeen);
    const alice = picture(state, 'alice-player');
    const bob = picture(state, 'bob-player');
    expect([...alice.sourceIds]).toEqual(['alice']);
    expect([...bob.sourceIds]).toEqual(['bob']);
    expect(alice.shown.has('aliceNpc')).toBe(true);
    expect(alice.shown.has('bobNpc')).toBe(false);
    expect(bob.shown.has('aliceNpc')).toBe(false);
    expect(bob.shown.has('bobNpc')).toBe(true);
    expect(alice.shown.has('bob')).toBe(true);
    expect(alice.shown.has('hidden')).toBe(false);
    expect(alice.pointsSeen([{ x: 800, y: 100 }])).toEqual([false]);
  });

  it('fails closed with no owned source, but keeps explicit tokenVision false', () => {
    const state = initial();
    const none = picture(state, 'spectator');
    expect(none.sight.all).toBe(false);
    expect(none.sight.regions).toEqual([]);
    expect(none.shown.has('aliceNpc')).toBe(false);
    expect(none.shown.has('alice')).toBe(true);
    const open = picture({ ...state, lighting: { ...state.lighting, tokenVision: false } }, 'spectator');
    expect(open.sight.all).toBe(true);
    expect(open.shown.has('aliceNpc')).toBe(true);
  });

  it('keeps pending sources from opening another source region', () => {
    const model = new RecipientPicture();
    model.update(initial(), { bounds: { width: 1400, height: 800 }, measurement, rules: { ...GENERIC_SIGHT_RULES, visionOf: () => ({ senses: [], pending: true }) } });
    const view = model.project('alice-player', owner);
    expect(view?.sight.all).toBe(false);
    expect(view?.sight.regions).toEqual([]);
    expect(view?.shown.has('aliceNpc')).toBe(false);
  });

  it('discloses unseen carried illumination without token identity or art', () => {
    const view = picture(initial(), 'alice-player');
    const ids = new Map<string, string>();
    const inputs = sharedSight({ state: view.state, rules: view.rules, shown: view.shown, policy: view.policy,
      tokenAlias: id => `token-${id}`, lightAlias: id => { const alias = `light-${ids.size}`; ids.set(id, alias); return alias; },
    });
    expect(inputs.tokens.some(entry => entry.id === 'token-bobNpc')).toBe(false);
    expect(inputs.tokens.find(entry => entry.id === 'token-bob')?.vision).toBeUndefined();
    expect(inputs.tokens.find(entry => entry.id === 'token-bob')?.alwaysSeen).toBe(true);
    expect(ids.has('carried:bobNpc')).toBe(true);
    expect(ids.has('carried:hidden')).toBe(false);
    const light = inputs.lights.find(entry => entry.id === ids.get('carried:bobNpc'));
    expect(light).toMatchObject({ x: 830, y: 120 });
    expect(JSON.stringify(light)).not.toContain('bobNpc');
  });

  it('applies displayed-centre fog without dropping the covered source', () => {
    const model = new RecipientPicture();
    const state = initial();
    const covered: SceneState = { ...state, objects: { ...state.objects, fog: { cover: { kind: 'fog', id: 'cover', type: 'rectangle', x: 500, y: 0, width: 500, height: 500, isErasing: false, timestamp: 1 } } } };
    model.update(covered, { bounds: { width: 1400, height: 800 }, rules: GENERIC_SIGHT_RULES, measurement, drawn: new Map([['alice', { x: 600, y: 100 }]]) });
    const view = model.project('alice-player', owner);
    expect(view?.shown.has('alice')).toBe(false);
    expect(view?.sourceIds.has('alice')).toBe(true);
  });

  it('serializes isolated whole pictures and consecutive recipient delta bases', () => {
    const state = initial();
    const alice = recipient('alice-player');
    const bob = recipient('bob-player');
    alice.share.update(snapshot(picture(state, 'alice-player')));
    bob.share.update(snapshot(picture(state, 'bob-player')));
    for (const [target, forbidden] of [[alice, 'bobNpc'], [bob, 'aliceNpc']] as const) {
      const first = packets(target.sent)[0];
      expect(first?.whole).toBe(true);
      expect(parseGmMessage(JSON.parse(JSON.stringify(first)))).not.toBeNull();
      expect(JSON.stringify(first)).not.toContain(forbidden);
      expect(first?.messages.filter(message => message.t !== 'live')).toHaveLength(12);
    }
    const next = { ...state, objects: { ...state.objects, tokens: { ...state.objects.tokens, aliceNpc: { ...state.objects.tokens.aliceNpc!, x: 132 } } } };
    alice.share.update(snapshot(picture(next, 'alice-player')));
    const reader = new DeltaReader();
    for (const packet of packets(alice.sent)) for (const message of packet.messages) expect(reader.read(message)).not.toBe('gap');
    expect(packets(alice.sent).at(-1)?.revision).toBe(2);
    expect(packets(bob.sent)).toHaveLength(1);
    const queued = alice.sent[0]?.validity;
    alice.share.stop();
    expect(queued?.valid()).toBe(false);
  });

  it('revokes in-flight reads and queued chunks after recipient authority changes', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const hash = await sha256Hex(bytes);
    const deferred = Promise.withResolvers<{ bytes: Uint8Array<ArrayBuffer>; mime: string } | null>();
    let allowed = true;
    const sent: { body: GmMessage; valid: (() => boolean) | undefined }[] = [];
    const delivered = Promise.withResolvers<void>();
    const assets = new AssetAnswers({ now: () => 0, readImage: () => deferred.promise, send: (body, _to, valid) => {
      sent.push({ body, valid });
      if (body.t === 'asset-chunk') delivered.resolve();
    } }, {
      map: () => null, explored: () => undefined, artPath: (requested, player) => allowed && player === 'alice' && requested === hash ? 'private.webp' : undefined,
    });
    assets.answer('alice', { t: 'asset-request', hash });
    allowed = false;
    deferred.resolve({ bytes, mime: 'image/webp' });
    await deferred.promise;
    await Promise.resolve();
    expect(sent).toEqual([]);
    assets.answer('bob', { t: 'asset-request', hash });
    expect(sent.at(-1)?.body.t).toBe('asset-refused');
    allowed = true;
    assets.forget('alice');
    assets.answer('alice', { t: 'asset-request', hash, from: 0 });
    await delivered.promise;
    const chunk = sent.find(entry => entry.body.t === 'asset-chunk');
    expect(chunk).toBeDefined();
    allowed = false;
    expect(chunk?.valid?.()).toBe(false);
  });
});
