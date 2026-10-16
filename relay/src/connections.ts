import type { PlayerInfo } from '../../src/app/online/protocol/relay.ts';

export type Role = 'pending' | 'gm' | 'player';
export interface Attachment {
  role: Role;
  generation: number;
  deadline: number;
  id?: string;
  name?: string;
  tokens: number;
  updatedAt: number;
}

export interface LivePlayer extends PlayerInfo {
  readonly generation: number;
}

export function attachment(socket: WebSocket): Attachment | null {
  const value = socket.deserializeAttachment() as Attachment | null;
  if (value === null || typeof value !== 'object' || typeof value.generation !== 'number') return null;
  return value;
}

export function sendText(socket: WebSocket, text: string): boolean {
  try {
    socket.send(text);
    return true;
  } catch {
    return false;
  }
}

export function closeSocket(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason.slice(0, 120));
  } catch {
    return;
  }
}
