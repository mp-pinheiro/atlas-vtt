/**
 * What drawing a token's group needs to know of it. Apart from `types.ts`, which names the
 * plugin's token UI and so belongs to the plugin, so that the drawing helpers (`SpriteFactory`,
 * the badges, the sight of the players' tokens) can be shared with the players' browser client.
 */

import type { Container, Texture, TickerCallback } from 'pixi.js';
import type { TokenEntity } from '../../types';

/**
 * A token's root container. `SpriteFactory` attaches the metadata when it
 * builds the container, so every token container in the renderer carries it.
 */
export interface TokenGroupContainer extends Container {
  tokenId: string;
  tokenData: TokenEntity;
  /** Rendered diameter in world pixels. */
  tokenSize: number;
  /** Image path whose texture this group holds in the `TextureCache`. */
  artPath: string;
  strokeWidth: number;
  /** Ticker callback of the movement animation in flight, if any. */
  currentAnimation?: TickerCallback<unknown> | null;
}

/**
 * Token sprite creation and management
 */
export interface ITokenSpriteFactory {
  /**
   * Creates a complete token container with all visual elements
   * @param token The token entity data
   * @param texture The loaded texture for the token
   * @returns Promise resolving to the created container with token visuals
   */
  createTokenSprite(token: TokenEntity, texture: Texture): Promise<TokenGroupContainer>;

  /**
   * Updates the size of a token sprite based on grid changes
   * @param tokenId The token identifier
   * @param container The token container to update
   * @param size The new size multiplier
   */
  updateTokenSize(tokenId: string, container: TokenGroupContainer, size: number): void;

  /**
   * Updates the position of a token sprite
   * @param container The token container to update
   * @param x The new x coordinate
   * @param y The new y coordinate
   */
  updateTokenPosition(container: Container, x: number, y: number): void;

  /**
   * Updates the rotation of a token sprite
   * @param container The token container to update
   * @param rotation The rotation in degrees
   */
  updateTokenRotation(container: Container, rotation: number): void;

  /**
   * Destroys a token group with all of its children, including their geometry
   * @param container The token container to destroy
   */
  destroyTokenSprite(container: Container): void;
}
