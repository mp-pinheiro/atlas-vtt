import { describe, expect, it } from 'vitest';
import { RecipientMarks } from '../../../../src/app/online/gm/RecipientMarks';
import { GM_MARKS, type MarksMessage, type MeasureState, type SharedMeasure } from '../../../../src/app/online/protocol';
import type { Measurements } from '../../../../src/app/pixi/MeasureRenderer';

const ruler: SharedMeasure = { shape: 'line', a: [100, 100], b: [180, 100] };
const native: Measurements = { live: { shape: 'line', start: { x: 100, y: 100 }, end: { x: 180, y: 100 } }, kept: [] };
const state: MeasureState = { color: '#ffffff', live: ruler, kept: [] };

function fixture(): { marks: RecipientMarks; alice: Set<string>; bob: Set<string> } {
  const alice = new Set(['target']), bob = new Set<string>();
  const marks = new RecipientMarks(player => player === 'alice' ? alice : bob, () => [{ id: 'target', x: 100, y: 100, radius: 30 }], () => 100);
  marks.recheck('alice'); marks.recheck('bob');
  return { marks, alice, bob };
}

function message(who: string, measure: MeasureState = state): MarksMessage {
  return { t: 'marks', scene: 'scene', lasers: [], measures: [{ who, ...measure }] };
}

describe('recipient measurement origins', () => {
  it('removes a GM ruler with its origin token and never reveals one unseen at its start', () => {
    const f = fixture();
    f.marks.recordGm(native, null);
    expect(f.marks.filter('alice', message(GM_MARKS)).measures[0]?.live).toEqual(ruler);
    expect(f.marks.filter('bob', message(GM_MARKS)).measures).toEqual([]);
    f.alice.delete('target');
    expect(f.marks.recheck('alice')?.measures).toEqual([]);
    f.bob.add('target');
    expect(f.marks.filter('bob', message(GM_MARKS)).measures).toEqual([]);
    f.alice.add('target');
    expect(f.marks.recheck('alice')?.measures[0]?.live).toEqual(ruler);
  });

  it('keeps the original player-ruler authority after it becomes a persistent ruler', () => {
    const f = fixture();
    f.marks.recordPlayer('sender', state);
    f.marks.filter('alice', message('sender'));
    f.marks.filter('bob', message('sender'));
    const kept: MeasureState = { color: '#ffffff', live: null, kept: [ruler] };
    f.marks.recordPlayer('sender', kept);
    f.bob.add('target');
    expect(f.marks.filter('alice', message('sender', kept)).measures[0]?.kept).toEqual([ruler]);
    expect(f.marks.filter('bob', message('sender', kept)).measures).toEqual([]);
    f.alice.delete('target');
    expect(f.marks.recheck('alice')?.measures).toEqual([]);
  });

  it('leaves intentional floor measurements visible without granting token-bound measurements', () => {
    const f = fixture();
    const floor: SharedMeasure = { shape: 'circle', a: [400, 400], b: [450, 400] };
    const measurements: MeasureState = { color: '#ffffff', live: floor, kept: [] };
    f.marks.recordPlayer('sender', measurements);
    expect(f.marks.filter('bob', message('sender', measurements)).measures[0]?.live).toEqual(floor);
  });

  it('does not turn an identical hidden-start duplicate into an older visible ruler', () => {
    const f = fixture();
    f.marks.recordPlayer('sender', state);
    f.marks.recordPlayer('sender', { color: '#ffffff', live: null, kept: [ruler] });
    f.alice.delete('target');
    f.marks.recordPlayer('sender', { ...state, kept: [ruler] });
    const duplicate: MeasureState = { color: '#ffffff', live: null, kept: [ruler, ruler] };
    f.marks.recordPlayer('sender', duplicate);
    f.alice.add('target');
    expect(f.marks.filter('alice', message('sender', duplicate)).measures).toEqual([]);
  });

  it('keeps late recipients outside GM and player rulers that began on a token before they were ready', () => {
    const seen = new Set<string>();
    let x = 100;
    const marks = new RecipientMarks(() => seen, () => [{ id: 'target', x, y: 100, radius: 30 }], () => 100);
    marks.recordGm(native, null);
    marks.recordPlayer('sender', state);
    x = 500;
    seen.add('target');
    expect(marks.filter('late', message(GM_MARKS)).measures).toEqual([]);
    expect(marks.filter('late', message('sender')).measures).toEqual([]);
    const extended: SharedMeasure = { ...ruler, b: [200, 100] };
    marks.recordGm({ live: { ...native.live!, end: { x: 200, y: 100 } }, kept: [] }, null);
    marks.recordPlayer('sender', { ...state, live: extended });
    expect(marks.filter('late', message(GM_MARKS, { ...state, live: extended })).measures).toEqual([]);
    expect(marks.filter('late', message('sender', { ...state, live: extended })).measures).toEqual([]);
  });

  it('keeps known unbound floor rulers available to a late recipient', () => {
    const floor: SharedMeasure = { shape: 'line', a: [400, 400], b: [450, 400] };
    const marks = new RecipientMarks(() => new Set(), () => [], () => 100);
    marks.recordGm({ live: { shape: 'line', start: { x: 400, y: 400 }, end: { x: 450, y: 400 } }, kept: [] }, null);
    expect(marks.filter('late', message(GM_MARKS, { ...state, live: floor })).measures[0]?.live).toEqual(floor);
  });

  it('closes kept history whose beginning was never observed', () => {
    const marks = new RecipientMarks(() => new Set(['target']), () => [], () => 100);
    const kept: MeasureState = { ...state, live: null, kept: [ruler] };
    marks.recordGm({ live: null, kept: [native.live!] }, null);
    marks.recordPlayer('sender', kept);
    expect(marks.filter('late', message(GM_MARKS, kept)).measures).toEqual([]);
    expect(marks.filter('late', message('sender', kept)).measures).toEqual([]);
  });

  it('does not retain a departed sender or a previous scene measurement', () => {
    const f = fixture();
    f.marks.recordPlayer('sender', state);
    expect(f.marks.filter('alice', message('sender')).measures[0]?.live).toEqual(ruler);
    f.marks.playerLeft('sender');
    expect(f.marks.recheck('alice')?.measures).toEqual([]);
    f.marks.recordGm(native, null);
    f.marks.reset();
    expect(f.marks.filter('alice', message(GM_MARKS)).measures).toEqual([]);
  });
});
