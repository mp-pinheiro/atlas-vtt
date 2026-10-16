import { describe, expect, it } from 'vitest';
import { DeltaReader, parsePicture, parsePlayerMessage } from '../../../../src/app/online/protocol/index.ts';

const scene='s';
const grid={type:'square',size:70,offsetX:0,offsetY:0};
const channels=[
  {t:'tokens',scene,tokens:[],cell:70,snap:null,ignored:true},
  {t:'fog',scene,fog:null},
  {t:'sight',scene,lighting:{ambient:0},lights:[],tokens:[],held:[]},
  {t:'lighting',scene,cellSize:70,unitDistance:5,walls:[],zones:[],senses:[]},
  {t:'mine',scene,tokens:[]},
  {t:'grid',scene,grid:{type:'square',size:70,offsetX:0,offsetY:0,colour:null,alpha:1,lineWidth:1,lineType:'solid',numbers:null}},
  {t:'doors',scene,doors:[]},{t:'sensed',scene,tokens:[]},{t:'pins',scene,pins:[]},
  {t:'annotations',scene,drawings:[],texts:[]},
  {t:'rules',scene,grid,snap:true,measurement:{mode:'metric',unitType:'feet',unitDistance:5,ruleDistance:5,diagonalRule:'equidistant',rangeBands:[],coneAngle:90},accent:null},
  {t:'agency',scene,permissions:{approval:false,perPlayerVision:false,playerConditions:false,playerDoors:false},conditions:[],values:{}},
] as const;
describe('atomic picture packets',()=>{
  it('parses a complete picture through channel parsers, preserving null fog and stripping unknown fields',()=>{
    const packet=parsePicture({t:'picture',scene,revision:1,whole:true,messages:channels});
    expect(packet?.messages).toHaveLength(12);
    expect(packet?.messages[0]).toEqual({t:'tokens',scene,tokens:[],cell:70,snap:null});
    expect(packet?.messages[1]).toEqual({t:'fog',scene,fog:null});
  });
  it('refuses duplicate and full-plus-delta channels, missing whole channels, and cross-scene messages',()=>{
    expect(parsePicture({t:'picture',scene,revision:1,whole:false,messages:[channels[0],channels[0]]})).toBeNull();
    expect(parsePicture({t:'picture',scene,revision:1,whole:false,messages:[channels[0],{t:'delta',scene,of:'tokens',seq:2,lists:{tokens:{remove:[],upsert:[],order:[]}},set:{},unset:[]}]})).toBeNull();
    expect(parsePicture({t:'picture',scene,revision:1,whole:true,messages:[]})).toBeNull();
    expect(parsePicture({t:'picture',scene,revision:1,whole:false,messages:[{t:'fog',scene:'other',fog:null}]})).toBeNull();
    expect(parsePlayerMessage({t:'picture-resync',scene})).toEqual({t:'picture-resync',scene});
  });
  it('forks delta bases without sharing later updates',()=>{
    const base={t:'tokens',scene,seq:1,tokens:[],cell:70,snap:null} as const;
    const reader=new DeltaReader();
    reader.read(base);
    const fork=reader.fork();
    expect(fork.read({t:'delta',scene,of:'tokens',seq:2,lists:{tokens:{remove:[],upsert:[],order:[]}},set:{},unset:[]})).not.toBe('gap');
    expect(reader.read({t:'delta',scene,of:'tokens',seq:3,lists:{tokens:{remove:[],upsert:[],order:[]}},set:{},unset:[]})).toBe('gap');
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'a'.repeat(24)])('rejects a non-positive or non-integer picture revision %j', (revision) => {
    expect(parsePicture({ t: 'picture', scene, revision, whole: true, messages: channels })).toBeNull();
  });
  it('rejects invalid populated channels instead of retaining their unchecked fields', () => {
    const token = { id: 'a'.repeat(24), x: 70, y: 70, size: 70, cells: 1, rotation: 0, art: null, name: 'Hero', ring: null, claim: 'open', badge: null, ui: null };
    const message = { t: 'tokens', scene, tokens: [token], cell: 70, snap: null, seq: 1, vaultPath: 'private' };
    expect(parsePicture({ t: 'picture', scene, revision: 1, whole: false, messages: [message] })?.messages).toEqual([{ t: 'tokens', scene, tokens: [token], cell: 70, snap: null, seq: 1 }]);
    expect(parsePicture({ t: 'picture', scene, revision: 1, whole: false, messages: [{ ...message, cell: 0 }] })).toBeNull();
    expect(parsePicture({ t: 'picture', scene, revision: 1, whole: false, messages: [{ ...message, tokens: [{ ...token, x: Number.NaN }] }] })).toBeNull();
    expect(parsePicture({ t: 'picture', scene, revision: 1, whole: false, messages: [{ ...message, snap: { type: 'unknown' } }] })).toBeNull();
    expect(parsePicture({ t: 'picture', scene, revision: 1, whole: false, messages: [{ ...message, seq: -1 }] })).toBeNull();
  });
});
