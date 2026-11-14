// A small particle system drawn on a canvas over the board: glowing sparks and expanding rings.
// Everything is in canvas pixels, so sparks keep flying where they were thrown even when the
// board under them changes (a new Swipe Rush board, a resize).

// A phone draws far fewer at once: the extra sparks only pile up in the same glow.
const MAX_PARTICLES = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 240 : 600;
const SPRITE_SIZE = 64;
// A spark's sprite has a soft halo around its core, so it is drawn this much bigger than its size.
export const HALO = 2.6;

export const SPARK = 0;
export const RING = 1;

// One soft glowing dot per colour, drawn once and stamped for every spark of that colour.
const sprites = new Map();

export function glowSprite(color) {
  let sprite = sprites.get(color);
  if (sprite) return sprite;
  sprite = document.createElement('canvas');
  sprite.width = SPRITE_SIZE;
  sprite.height = SPRITE_SIZE;
  const context = sprite.getContext('2d');
  const half = SPRITE_SIZE / 2;
  const glow = context.createRadialGradient(half, half, 0, half, half, half);
  glow.addColorStop(0, 'rgba(255, 255, 255, 1)');
  glow.addColorStop(0.16, color);
  glow.addColorStop(0.42, `${color}55`);
  glow.addColorStop(1, `${color}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
  sprites.set(color, sprite);
  return sprite;
}

export class ParticleField {
  constructor() {
    this.items = [];
  }

  get count() {
    return this.items.length;
  }

  clear() {
    this.items.length = 0;
  }

  // Colours are #rrggbb strings. Speeds are pixels per second; `drag` is how fast they slow down.
  spark({ x, y, vx = 0, vy = 0, life = 0.5, size = 4, endSize = 0, color, drag = 3, gravity = 0, alpha = 1, twinkle = 0 }) {
    if (this.items.length >= MAX_PARTICLES) return;
    this.items.push({ kind: SPARK, x, y, vx, vy, age: 0, life, size, endSize, color, drag, gravity, alpha, twinkle, seed: Math.random() * 10 });
  }

  // An outline that grows from `from` to `to` pixels and fades. `squash` flattens it across
  // `angle`, for a shockwave running along a wall.
  ring({ x, y, from = 2, to = 30, life = 0.4, width = 2, color, alpha = 0.8, squash = 1, angle = 0, delay = 0 }) {
    if (this.items.length >= MAX_PARTICLES) return;
    this.items.push({ kind: RING, x, y, from, to, age: -delay, life, width, color, alpha, squash, angle });
  }

  step(seconds) {
    const { items } = this;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      item.age += seconds;
      if (item.age >= item.life) {
        items[index] = items[items.length - 1];
        items.pop();
        continue;
      }
      if (item.kind === SPARK && item.age > 0) {
        const slow = Math.exp(-item.drag * seconds);
        item.vx *= slow;
        item.vy = item.vy * slow + item.gravity * seconds;
        item.x += item.vx * seconds;
        item.y += item.vy * seconds;
      }
    }
  }

  // Drawn with additive blending: overlapping sparks glow brighter instead of covering each other.
  draw(context) {
    for (const item of this.items) {
      if (item.age < 0) continue;
      const progress = item.age / item.life;
      const fade = (1 - progress) ** 1.6;
      if (item.kind === SPARK) {
        const flicker = item.twinkle ? 1 - item.twinkle * (0.5 + 0.5 * Math.sin(item.age * 28 + item.seed)) : 1;
        const size = (item.size + (item.endSize - item.size) * progress) * HALO;
        if (size <= 0.2) continue;
        context.globalAlpha = Math.min(1, item.alpha * fade * flicker);
        context.drawImage(glowSprite(item.color), item.x - size / 2, item.y - size / 2, size, size);
      } else {
        const eased = 1 - (1 - progress) ** 3;
        const radius = item.from + (item.to - item.from) * eased;
        context.globalAlpha = item.alpha * fade;
        context.strokeStyle = item.color;
        context.lineWidth = Math.max(0.5, item.width * (1 - progress * 0.6));
        context.beginPath();
        context.ellipse(item.x, item.y, radius, radius * item.squash, item.angle, 0, Math.PI * 2);
        context.stroke();
      }
    }
    context.globalAlpha = 1;
  }
}
