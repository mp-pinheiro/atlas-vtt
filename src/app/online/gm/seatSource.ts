import type { Claim } from '../protocol/index.ts';
import type { TokenEntity } from '../../types';
import type { SceneStore } from './atlasView.ts';
import type { OwnedToken, Ownership } from './ownership.ts';
import { seeAsPlayers } from './playerTokenVision';

/** Who owns which token and which tokens are player tokens (`Ownership`). Only the GM gives a token to a player. */
export interface SeatSource {
  /** The ids of the players connected now. */
  onlinePlayers(): readonly string[];
  /** The owner of a token of the GM's scene, by its GM id and the token (`Ownership.ownerOf`). */
  ownerOf(tokenId: string, token: OwnedToken | undefined): string | undefined;
  /** What players may know of a token: a player token, or the GM's. */
  claimOf(mapPath: string, tokenId: string, token: TokenEntity): Claim;
}

/** The owner of a token of the scene in `store`, by its GM id, for whoever knows only the id. */
export function ownerIn(seats: SeatSource | undefined, store: SceneStore): (tokenId: string) => string | undefined {
  return (tokenId) => seats?.ownerOf(tokenId, store.getState().objects.tokens[tokenId]);
}

export function givePlayerTokens(ownership: Ownership, store: SceneStore | null, tokenIds: readonly string[], playerId: string | null): void {
  if (store !== null && playerId !== null && ownership.nameOf(playerId) !== null) seeAsPlayers(store, tokenIds, (id, token) => ownership.ownerOf(id, token) === undefined);
  ownership.give(tokenIds, store?.getState().objects.tokens ?? {}, playerId);
}
