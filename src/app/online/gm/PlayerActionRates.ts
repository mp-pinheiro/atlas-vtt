export class PlayerActionRates {
  private readonly players = new Map<string, { movement: number; action: number; at: number }>();

  movement(from: string, now: number): boolean {
    return this.take(from, now, 'movement');
  }

  action(from: string, now: number): boolean {
    return this.take(from, now, 'action');
  }

  playerLeft(from: string): void {
    this.players.delete(from);
  }

  clear(): void {
    this.players.clear();
  }

  private take(from: string, now: number, kind: 'movement' | 'action'): boolean {
    const bucket = this.players.get(from) ?? { movement: 8, action: 3, at: now };
    const elapsed = Math.max(0, now - bucket.at) / 1000;
    bucket.movement = Math.min(8, bucket.movement + elapsed * 6);
    bucket.action = Math.min(3, bucket.action + elapsed);
    bucket.at = Math.max(now, bucket.at);
    this.players.set(from, bucket);
    if (bucket[kind] < 1) return false;
    bucket[kind] -= 1;
    return true;
  }
}
