import { MAX_COORDINATE, MAX_NAME, MAX_TOKENS, TOKEN_ID_PATTERN } from './tokens.ts';
import { isRecord } from './shape.ts';
import { MAX_SCENE_ID } from './moves.ts';
import { MAX_TOKEN_VALUE } from './tokenUI.ts';

export const REQUEST_ID_PATTERN = /^[0-9a-f]{24}$/;
const scene = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_SCENE_ID;
const request = (v: unknown): v is string => typeof v === 'string' && REQUEST_ID_PATTERN.test(v);
const alias = (v: unknown): v is string => typeof v === 'string' && TOKEN_ID_PATTERN.test(v);

export interface ScenePermissions {
  readonly approval: boolean;
  readonly perPlayerVision: boolean;
  readonly playerConditions: boolean;
  readonly playerDoors: boolean;
}
export interface SharedConditionDefinition {
  readonly id: string;
  readonly name: string;
  readonly valued: boolean;
  readonly icon?: string;
  readonly colour: string;
}
export interface AgencyMessage {
  readonly t: 'agency';
  readonly scene: string;
  readonly permissions: ScenePermissions;
  readonly conditions: readonly SharedConditionDefinition[];
  readonly values: Readonly<Record<string, Readonly<Record<string, number>>>>;
}
export type ClaimStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
export type ClaimResult = { readonly t: 'claim-result'; readonly scene: string; readonly id: string; readonly request: string; readonly status: ClaimStatus };
export type PlayerAgencyMessage =
  | { readonly t: 'player-ready'; readonly agency: 1 }
  | { readonly t: 'claim-request'; readonly scene: string; readonly id: string; readonly request: string }
  | { readonly t: 'colour'; readonly colour: number }
  | { readonly t: 'initiative-roll'; readonly scene: string; readonly combatant: string }
  | { readonly t: 'end-turn'; readonly scene: string; readonly round: number; readonly combatant: string; readonly turnKey: string }
  | { readonly t: 'condition'; readonly scene: string; readonly id: string; readonly condition: string; readonly value: number }
  | { readonly t: 'path'; readonly scene: string; readonly id: string; readonly request: string; readonly points: readonly { readonly x: number; readonly y: number }[] }
  | { readonly t: 'path-cancel'; readonly scene: string; readonly id: string; readonly request: string }
  | { readonly t: 'door'; readonly scene: string; readonly id: string; readonly request: string };
export type AgencyResponse =
  | AgencyMessage | ClaimResult
  | { readonly t: 'path-result'; readonly scene: string; readonly id: string; readonly request: string; readonly result: 'approved' | 'cancelled'; readonly reason?: 'stale' | 'replaced' | 'refused' | 'blocked'; readonly points?: readonly { readonly x: number; readonly y: number }[] }
  | { readonly t: 'door-result'; readonly scene: string; readonly id: string; readonly request: string; readonly result: 'opened' | 'closed' | 'refused' }
  | { readonly t: 'initiative-refused'; readonly scene: string; readonly combatant: string; readonly action: 'roll' | 'end-turn' };

const pointList = (v: unknown): {x:number;y:number}[] | null => {
  if (!Array.isArray(v) || v.length < 1 || v.length > 32) return null;
  const out: {x:number;y:number}[] = [];
  for (const p of v) {
    if (!isRecord(p) || typeof p.x !== 'number' || !Number.isFinite(p.x) || Math.abs(p.x) > MAX_COORDINATE || typeof p.y !== 'number' || !Number.isFinite(p.y) || Math.abs(p.y) > MAX_COORDINATE) return null;
    out.push({x:p.x,y:p.y});
  }
  return out;
};
export function parsePlayerAgency(value: Record<string, unknown>): PlayerAgencyMessage | null {
  if (value.t === 'player-ready') return value.agency === 1 ? {t:'player-ready',agency:1} : null;
  if (value.t === 'colour') return Number.isInteger(value.colour) && (value.colour as number) >= 0 && (value.colour as number) <= 7 ? {t:'colour',colour:value.colour as number} : null;
  if (value.t === 'claim-request') return scene(value.scene)&&alias(value.id)&&request(value.request)?{t:value.t,scene:value.scene,id:value.id,request:value.request}:null;
  if (value.t === 'initiative-roll') return scene(value.scene)&&alias(value.combatant)?{t:value.t,scene:value.scene,combatant:value.combatant}:null;
  if (value.t === 'end-turn') return scene(value.scene)&&Number.isSafeInteger(value.round)&&typeof value.round==='number'&&value.round>=0&&alias(value.combatant)&&request(value.turnKey)?{t:value.t,scene:value.scene,round:value.round,combatant:value.combatant,turnKey:value.turnKey}:null;
  if (value.t === 'condition') return scene(value.scene)&&alias(value.id)&&typeof value.condition==='string'&&value.condition.length>0&&value.condition.length<=64&&!(value.condition in Object.prototype)&&Number.isSafeInteger(value.value)&&typeof value.value==='number'&&value.value>=0&&value.value<=MAX_TOKEN_VALUE?{t:value.t,scene:value.scene,id:value.id,condition:value.condition,value:value.value}:null;
  if (value.t === 'path') { const points=pointList(value.points); return scene(value.scene)&&alias(value.id)&&request(value.request)&&points?{t:value.t,scene:value.scene,id:value.id,request:value.request,points}:null; }
  if (value.t==='path-cancel'||value.t==='door') return scene(value.scene)&&alias(value.id)&&request(value.request)?{t:value.t,scene:value.scene,id:value.id,request:value.request}:null;
  return null;
}
export function parseAgencyResponse(value: Record<string, unknown>): AgencyResponse | null {
  if (value.t==='initiative-refused') return scene(value.scene)&&alias(value.combatant)&&(value.action==='roll'||value.action==='end-turn')?{t:value.t,scene:value.scene,combatant:value.combatant,action:value.action}:null;
  if (value.t==='door-result') return scene(value.scene)&&alias(value.id)&&request(value.request)&&['opened','closed','refused'].includes(value.result as string)?{t:value.t,scene:value.scene,id:value.id,request:value.request,result:value.result as 'opened'|'closed'|'refused'}:null;
  if (value.t==='claim-result') return scene(value.scene)&&alias(value.id)&&request(value.request)&&['pending','accepted','declined','cancelled'].includes(value.status as string)?{t:value.t,scene:value.scene,id:value.id,request:value.request,status:value.status as ClaimStatus}:null;
  if(value.t==='path-result') {
    const points=value.points===undefined?undefined:pointList(value.points);
    if(!scene(value.scene)||!alias(value.id)||!request(value.request)||!['approved','cancelled'].includes(value.result as string)||(value.reason!==undefined&&!['stale','replaced','refused','blocked'].includes(value.reason as string))||(value.points!==undefined&&!points)) return null;
    return {t:value.t,scene:value.scene,id:value.id,request:value.request,result:value.result as 'approved'|'cancelled',...(value.reason!==undefined?{reason:value.reason as 'stale'|'replaced'|'refused'|'blocked'}:{}),...(points?{points}:{})};
  }
  const permissions=value.permissions;
  if(value.t==='agency'&&scene(value.scene)&&isRecord(permissions)&&['approval','perPlayerVision','playerConditions','playerDoors'].every(k=>typeof permissions[k]==='boolean')&&Array.isArray(value.conditions)&&value.conditions.length<=256&&isRecord(value.values)&&Object.keys(value.values).length<=MAX_TOKENS) {
    const conditions:SharedConditionDefinition[]=[];
    for(const item of value.conditions) {
      if(!isRecord(item)||typeof item.id!=='string'||item.id.length===0||item.id.length>64||item.id in Object.prototype||conditions.some(condition=>condition.id===item.id)||typeof item.name!=='string'||item.name.length>MAX_NAME||typeof item.valued!=='boolean'||typeof item.colour!=='string'||!/^#[0-9a-f]{6}$/i.test(item.colour)||(item.icon!==undefined&&(typeof item.icon!=='string'||item.icon.length>64))) return null;
      conditions.push({id:item.id,name:item.name,valued:item.valued,colour:item.colour,...(item.icon?{icon:item.icon}:{})});
    }
    const values:Record<string,Record<string,number>>={};
    for(const [id,entry] of Object.entries(value.values)) {
      if(!alias(id)||!isRecord(entry)||Object.keys(entry).length>256) return null;
      const v:Record<string,number>={};
      for(const [key,n] of Object.entries(entry)) { if(key.length===0||key.length>64||key in Object.prototype||!Number.isSafeInteger(n)||typeof n!=='number'||n<0||n>MAX_TOKEN_VALUE)return null; v[key]=n; }
      values[id]=v;
    }
    return {t:'agency',scene:value.scene,permissions:{approval:permissions.approval as boolean,perPlayerVision:permissions.perPlayerVision as boolean,playerConditions:permissions.playerConditions as boolean,playerDoors:permissions.playerDoors as boolean},conditions,values};
  }
  return null;
}
