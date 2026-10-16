import { describe, expect, it } from 'vitest';
import { parseAgencyResponse, parsePlayerAgency, parsePlayerSheet, parseSharedSheet } from '../../../../src/app/online/protocol/index.ts';

const id='0123456789abcdef01234567';
describe('agency wire contracts',()=>{
  it('accepts readiness, correlated requests and bounded path points while stripping extras',()=>{
    expect(parsePlayerAgency({t:'player-ready',agency:1,secret:'drop'})).toEqual({t:'player-ready',agency:1});
    expect(parsePlayerAgency({t:'path',scene:'s',id,request:id,points:[{x:3,y:4,extra:'drop'}]})).toEqual({t:'path',scene:'s',id,request:id,points:[{x:3,y:4}]});
    expect(parsePlayerAgency({t:'path',scene:'s',id,request:'bad',points:[{x:0,y:0}]})).toBeNull();
    expect(parsePlayerAgency({t:'path',scene:'s',id,request:id,points:Array.from({length:33},()=>({x:0,y:0}))})).toBeNull();
  });
  it('validates directed results and colour bounds',()=>{
    expect(parsePlayerAgency({t:'colour',colour:7})).toEqual({t:'colour',colour:7});
    expect(parsePlayerAgency({t:'colour',colour:8})).toBeNull();
    expect(parseAgencyResponse({t:'door-result',scene:'s',id,request:id,result:'refused'})).toEqual({t:'door-result',scene:'s',id,request:id,result:'refused'});
  });
  it('accepts strict JSON sheets with native blocks and rejects executable/opaque forms',()=>{
    const sheet={revision:id,name:'Hero',template:{format:'atlas-statblock-template',version:1,id:'builtin:test',fields:[],layout:{maxColumns:1,blocks:[{id:'abcd1234',type:'text',text:'safe'}]}},fields:{hp:4},images:{},rolls:[]};
    expect(parseSharedSheet({...sheet,ignored:'drop'})).toEqual(sheet);
    expect(parseSharedSheet({...sheet,template:{...sheet.template,layout:{maxColumns:1,blocks:[{id:'abcd1234',type:'script',fs:{source:'x'}}]}}})).toBeNull();
    expect(parsePlayerSheet({t:'sheet-roll',sheet:id,index:0,mode:'public',formula:'forbidden'})).toEqual({t:'sheet-roll',sheet:id,index:0,mode:'public'});
  });
  it('uses the shared condition-value boundary and refuses prototype identifiers', () => {
    const request = { t: 'condition', scene: 's', id, condition: 'frightened', value: 1_000_000_000 };
    expect(parsePlayerAgency(request)).toEqual(request);
    expect(parsePlayerAgency({ ...request, value: 1_000_000_001 })).toBeNull();
    expect(parsePlayerAgency({ ...request, value: 1.5 })).toBeNull();
    expect(parsePlayerAgency({ ...request, condition: '__proto__' })).toBeNull();
    const message = { t: 'agency', scene: 's', permissions: { approval: false, perPlayerVision: false, playerConditions: true, playerDoors: false }, conditions: [{ id: 'frightened', name: 'Frightened', valued: true, colour: '#aabbcc' }], values: { [id]: { frightened: 1_000_000_000 } } };
    expect(parseAgencyResponse(message)).toEqual(message);
    expect(parseAgencyResponse({ ...message, values: { [id]: { frightened: 1_000_000_001 } } })).toBeNull();
    expect(parseAgencyResponse({ ...message, values: { [id]: JSON.parse('{"__proto__":1}') } })).toBeNull();
  });
});
