import { isRecord } from './shape.ts';
import { MAX_SCENE_ID } from './moves.ts';
import { parseGmMessage, type GmMessage } from './game.ts';
import type { AgencyMessage } from './agency.ts';
import type { DeltaMessage } from './delta.ts';

export type PictureChannel = 'tokens'|'fog'|'sight'|'lighting'|'mine'|'grid'|'doors'|'sensed'|'pins'|'annotations'|'rules'|'agency'|'live';
export type PictureMessage = Extract<GmMessage,{t:'tokens'|'fog'|'sight'|'lighting'|'mine'|'grid'|'doors'|'sensed'|'pins'|'annotations'|'rules'|'live'}> | AgencyMessage | DeltaMessage;
export interface PicturePacket {readonly t:'picture';readonly scene:string;readonly revision:number;readonly whole:boolean;readonly messages:readonly PictureMessage[]}
export interface PictureResync {readonly t:'picture-resync';readonly scene:string}
const ALLOWED: Readonly<Record<string, true>> = {
  tokens: true, fog: true, sight: true, lighting: true, mine: true, grid: true, doors: true,
  sensed: true, pins: true, annotations: true, rules: true, agency: true, live: true, delta: true,
};
function isPictureMessage(message:GmMessage):message is PictureMessage {
  return message.t==='tokens'||message.t==='fog'||message.t==='sight'||message.t==='lighting'||message.t==='mine'||message.t==='grid'||message.t==='doors'||message.t==='sensed'||message.t==='pins'||message.t==='annotations'||message.t==='rules'||message.t==='live'||message.t==='delta'||message.t==='agency';
}
function child(value:unknown,scene:string):PictureMessage|null {
  if(!isRecord(value)||typeof value.t!=='string'||!Object.hasOwn(ALLOWED,value.t))return null;
  const parsed=parseGmMessage(value);
  if(!parsed||!isPictureMessage(parsed))return null;
  return parsed.scene===scene?parsed:null;
}
function channelOf(message:PictureMessage):string{return message.t==='delta'?message.of:message.t;}
export function parsePicture(value:unknown):PicturePacket|null {
  if(!isRecord(value)||value.t!=='picture'||typeof value.scene!=='string'||value.scene.length===0||value.scene.length>MAX_SCENE_ID||!Number.isSafeInteger(value.revision)||typeof value.revision!=='number'||value.revision<1||typeof value.whole!=='boolean'||!Array.isArray(value.messages)||value.messages.length>16)return null;
  const messages:PictureMessage[]=[];
  const seen=new Set<string>();
  for(const raw of value.messages){
    const message=child(raw,value.scene);
    if(!message)return null;
    const channel=channelOf(message);
    if(seen.has(channel))return null;
    seen.add(channel);
    messages.push(message);
  }
  if(value.whole){
    const required:readonly string[]=['tokens','fog','sight','lighting','mine','grid','doors','sensed','pins','annotations','rules','agency'];
    if(required.some(channel=>!seen.has(channel))||messages.some(message=>message.t==='delta'))return null;
  }
  return {t:'picture',scene:value.scene,revision:value.revision,whole:value.whole,messages};
}
export function parsePictureResync(value:unknown):PictureResync|null{return isRecord(value)&&value.t==='picture-resync'&&typeof value.scene==='string'&&value.scene.length>0&&value.scene.length<=MAX_SCENE_ID?{t:'picture-resync',scene:value.scene}:null;}
