import { CanvasSource, Texture } from 'pixi.js';

let cached: Texture | null = null;

export function tokenGlassTexture(): Texture {
  if (cached && !cached.destroyed) return cached;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Token glass requires a 2D canvas');
  const c = size / 2;
  const r = c;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.clip();
  const vignette = ctx.createRadialGradient(c, c, r * 0.3, c, c, r);
  for (const [at, alpha] of [[0, 0], [0.55, 0], [0.65, 0.03], [0.75, 0.08], [0.82, 0.15], [0.88, 0.25], [0.93, 0.35], [0.97, 0.45], [1, 0.55]] as const) {
    vignette.addColorStop(at, `rgba(0, 0, 0, ${alpha})`);
  }
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);
  const highlight = ctx.createRadialGradient(c, c - r * 0.15, r * 0.1, c, c - r * 0.15, r * 0.85);
  for (const [at, alpha] of [[0, 0.2], [0.3, 0.06], [0.5, 0.02], [1, 0]] as const) highlight.addColorStop(at, `rgba(255, 255, 255, ${alpha})`);
  ctx.fillStyle = highlight;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fill();
  for (const [dx, dy, radius, stops] of [
    [-0.32, -0.35, 0.4, [[0, 0.18], [0.4, 0.06], [1, 0]]],
    [-0.18, -0.5, 0.22, [[0, 0.14], [0.5, 0.04], [1, 0]]],
  ] as const) {
    const glow = ctx.createRadialGradient(c + r * dx, c + r * dy, 0, c + r * dx, c + r * dy, r * radius);
    for (const [at, alpha] of stops) glow.addColorStop(at, `rgba(255, 255, 255, ${alpha})`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(c + r * dx, c + r * dy, r * radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(c, c, r - 2, Math.PI * 0.15, Math.PI * 0.85);
  const rim = ctx.createLinearGradient(c - r, c + r * 0.7, c + r, c + r * 0.7);
  for (const [at, alpha] of [[0, 0], [0.3, 0.1], [0.5, 0.15], [0.7, 0.1], [1, 0]] as const) rim.addColorStop(at, `rgba(255, 255, 255, ${alpha})`);
  ctx.strokeStyle = rim;
  ctx.lineWidth = 3;
  ctx.stroke();
  cached = new Texture({ source: new CanvasSource({ resource: canvas, autoGenerateMipmaps: true, scaleMode: 'linear' }) });
  return cached;
}
