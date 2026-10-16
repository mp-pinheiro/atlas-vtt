import type { GmMessage, PlayerMessage } from '../protocol';

export function sceneRefusal(message: PlayerMessage): GmMessage | null {
  switch (message.t) {
    case 'move': case 'drag': case 'drag-cancel':
      return { t: 'move-refused', scene: message.scene, id: message.id, x: null, y: null };
    case 'roll': return { t: 'roll-refused', reason: 'scene' };
    case 'sheet-roll': return { t: 'roll-refused', reason: 'unavailable' };
    case 'initiative-roll': case 'end-turn':
      return { t: 'initiative-refused', scene: message.scene, combatant: message.combatant, action: message.t === 'initiative-roll' ? 'roll' : 'end-turn' };
    case 'claim-request':
      return { t: 'claim-result', scene: message.scene, id: message.id, request: message.request, status: 'cancelled' };
    case 'path': case 'path-cancel':
      return { t: 'path-result', scene: message.scene, id: message.id, request: message.request, result: 'cancelled', reason: 'stale' };
    case 'door': return { t: 'door-result', scene: message.scene, id: message.id, request: message.request, result: 'refused' };
    case 'condition': case 'pin-found': return { t: 'scene', scene: null };
    case 'asset-request': return { t: 'asset-refused', hash: message.hash };
    default: return null;
  }
}
