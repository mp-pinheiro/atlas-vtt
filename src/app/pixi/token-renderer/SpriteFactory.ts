import { Container, type Graphics, type Sprite, type Texture } from 'pixi.js';
import { TokenVisual, type TokenArtworkView } from './TokenVisual';
import type { TokenEntity } from '../../types';
import type { GridSystem } from '../../grid/GridSystem';
import { destroyTree } from '../utils/destroyTree';
import { loadedTokenRingTexture, loadTokenRingTexture } from './tokenRingTexture';
import { computeTokenPixelSize, computeTokenStrokeWidth } from './tokenSizing';

export interface TokenSpriteGroup extends TokenArtworkView<TokenEntity> {
  tokenId: string;
  artPath: string;
}

export interface ITokenSpriteFactory {
  createTokenSprite(token: TokenEntity, texture: Texture): Promise<TokenSpriteGroup>;
  updateTokenSize(tokenId: string, container: TokenSpriteGroup, size: number): void;
  updateTokenPosition(container: Container, x: number, y: number): void;
  updateTokenRotation(container: Container, rotation: number): void;
  destroyTokenSprite(container: Container): void;
}

export class SpriteFactory implements ITokenSpriteFactory {
  private onTokenRingTextureReady: (() => void) | undefined;
  private ringTextureLoad: Promise<Texture | null> | null = null;

  constructor(private readonly gridSystem: GridSystem, public isPlayerView: boolean = false) {}

  async createTokenSprite(token: TokenEntity, texture: Texture): Promise<TokenSpriteGroup> {
    const gridSize = this.gridSystem.getOptions().size;
    const tokenSize = computeTokenPixelSize(gridSize, token.size || 1);
    const view: TokenSpriteGroup = Object.assign(TokenVisual.create(texture, tokenSize), {
      tokenId: token.id,
      tokenData: token,
      tokenSize,
      artPath: token.imagePath ?? '',
      strokeWidth: computeTokenStrokeWidth(gridSize),
    });
    view.zIndex = token.layer || 0;
    view.position.set(token.x, token.y);
    TokenVisual.rotation(view, token.rotation || 0);
    this.createTokenRing(view, token.ringColor || '#ffffff');
    return view;
  }

  updateTokenSize(_tokenId: string, container: TokenSpriteGroup, size: number): void {
    const gridSize = this.gridSystem.getOptions().size;
    TokenVisual.resize(container, computeTokenPixelSize(gridSize, size), computeTokenStrokeWidth(gridSize));
  }

  updateTokenPosition(container: Container, x: number, y: number): void {
    container.position.set(x, y);
  }

  updateTokenRotation(container: Container, rotation: number): void {
    TokenVisual.rotation(container, rotation);
  }

  setTokenRingTextureReadyCallback(callback: (() => void) | undefined): void {
    this.onTokenRingTextureReady = callback;
  }

  preloadTokenRingTexture(): Promise<Texture | null> {
    if (!this.ringTextureLoad) {
      this.ringTextureLoad = loadTokenRingTexture().then((texture) => {
        if (texture) this.onTokenRingTextureReady?.();
        return texture;
      });
    }
    return this.ringTextureLoad;
  }

  createTokenRing(container: TokenSpriteGroup, ringColor: string | null, tokenSizeOverride?: number): Sprite | Graphics | null {
    const texture = loadedTokenRingTexture();
    if (!texture) void this.preloadTokenRingTexture();
    return TokenVisual.ring(container, ringColor, texture, tokenSizeOverride);
  }


  destroyTokenSprite(container: Container): void {
    destroyTree(container);
  }
}
