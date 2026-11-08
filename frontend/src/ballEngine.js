// Drives the ball and its effects outside React. A frame loop moves the ball along each slide,
// squashes and stretches it on springs (so it wobbles like jelly when it hits a wall), and draws
// the sparks, its comet tail and the light it casts on a canvas laid over the board. The loop
// sleeps whenever nothing is moving.

import { DIRECTION_STEPS } from './game.js';
import { SLIDE_EASE, UNDO_EASE, spring, springAtRest, stepSpring } from './motion.js';
import { glowSprite, HALO, ParticleField } from './particles.js';

// How far the canvas reaches past the board on each side (keep in sync with .board-fx), so
// sparks thrown off the edge are not cut off there.
const MARGIN = 32;
// The ball's radius in squares: it is 64% of a square across (see .board-player-body).
const RADIUS = 0.32;
// Springs are stepped at least this finely, so a slow frame can never make them blow up.
const MAX_STEP = 1 / 240;

const PALETTES = {
  level: {
    spark: ['#ff5a64', '#ff8f8a', '#ffc4b8', '#ff3d5e'],
    tail: '#ff5c60',
    glow: [255, 86, 92],
    paint: ['#4ef3d0', '#8bf5dc', '#62e6d5', '#bdfff0'],
    burst: ['#4ef3d0', '#8be9ff', '#ffffff', '#ff8f9a', '#ffd27a', '#7cf0c8'],
    ring: '#c4fff2',
    rewind: ['#bfe9ff', '#8be9ff', '#ffffff'],
  },
  rush: {
    spark: ['#ff6b4a', '#ffa36b', '#ffd6a8', '#ff4f3d'],
    tail: '#ff6a46',
    glow: [255, 100, 60],
    paint: ['#ff8a3d', '#ffb25c', '#ffd27a', '#ff6a2b'],
    burst: ['#ffcf6b', '#ff8a3d', '#ffffff', '#ff5a3c', '#ffe3b0'],
    ring: '#ffe0b0',
    rewind: ['#ffe3b0', '#ffcf6b', '#ffffff'],
  },
};

const random = (low, high) => low + Math.random() * (high - low);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export class BallEngine {
  constructor({ layer, canvas, player, body, mode, rows, cols }) {
    this.layer = layer;
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.playerElement = player;
    this.bodyElement = body;
    this.palette = PALETTES[mode] ?? PALETTES.level;
    this.rows = rows;
    this.cols = cols;
    this.reduced = prefersReducedMotion();
    this.particles = new ParticleField();
    this.scheduled = [];
    // The ball's centre in squares (column, row), and the end of its comet tail, which chases it.
    this.x = 0;
    this.y = 0;
    this.tailX = 0;
    this.tailY = 0;
    this.slide = null;
    this.speed = 0;
    this.axis = 'x';
    // Squash and stretch, a nudge off its square (into a wall it hit), and an overall size for
    // popping in. All springs, so every change of shape overshoots a little and wobbles back.
    this.scaleX = spring(1);
    this.scaleY = spring(1);
    this.offsetX = spring(0);
    this.offsetY = spring(0);
    this.pop = spring(1);
    this.pendingCelebration = null;
    this.frame = 0;
    this.lastTime = 0;
    this.destroyed = false;
    this.tick = this.tick.bind(this);
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.measure()) : null;
    this.resizeObserver?.observe(layer);
    this.measure();
  }

  destroy() {
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.resizeObserver?.disconnect();
  }

  setMode(mode) {
    this.palette = PALETTES[mode] ?? PALETTES.level;
  }

  setBoard(rows, cols) {
    if (rows === this.rows && cols === this.cols) return;
    this.rows = rows;
    this.cols = cols;
    this.measure();
  }

  // Reads the board's size in pixels and fits the canvas to it.
  measure() {
    const width = this.layer.clientWidth;
    const height = this.layer.clientHeight;
    const gap = parseFloat(getComputedStyle(this.layer).getPropertyValue('--gap')) || 0;
    const cellWidth = Math.max(1, (width - (this.cols - 1) * gap) / this.cols);
    const cellHeight = Math.max(1, (height - (this.rows - 1) * gap) / this.rows);
    this.geometry = {
      cellWidth,
      cellHeight,
      pitchX: cellWidth + gap,
      pitchY: cellHeight + gap,
      unit: Math.min(cellWidth, cellHeight),
    };
    this.ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvasWidth = width + MARGIN * 2;
    this.canvasHeight = height + MARGIN * 2;
    const pixelWidth = Math.round(this.canvasWidth * this.ratio);
    const pixelHeight = Math.round(this.canvasHeight * this.ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.wake();
  }

  // The centre of a point on the board, given in squares, in canvas pixels.
  toPixels(x, y) {
    const { cellWidth, cellHeight, pitchX, pitchY } = this.geometry;
    return [MARGIN + x * pitchX + cellWidth / 2, MARGIN + y * pitchY + cellHeight / 2];
  }

  // ---------- What the game tells the ball ----------

  // `anim` is the App's latest animation: a move, an undo, a restart or a fresh board.
  handle(anim, target) {
    const kind = anim.kind ?? 'move';
    if (kind === 'load') {
      this.place(target.row, target.col, { pop: true });
      return;
    }
    if (kind === 'restart') {
      this.poof();
      this.place(target.row, target.col, { pop: true });
      return;
    }
    if (this.reduced || !anim.slideMs) {
      this.place(target.row, target.col);
      return;
    }
    if (kind === 'undo') this.glide(target, anim.slideMs);
    else this.launch(target, anim);
  }

  // Puts the ball straight on a square, optionally popping it in from nothing.
  place(row, col, { pop = false } = {}) {
    this.slide = null;
    this.pendingCelebration = null;
    this.x = col;
    this.y = row;
    this.tailX = col;
    this.tailY = row;
    this.speed = 0;
    for (const state of [this.scaleX, this.scaleY, this.pop]) {
      state.value = 1;
      state.velocity = 0;
    }
    for (const state of [this.offsetX, this.offsetY]) {
      state.value = 0;
      state.velocity = 0;
    }
    if (pop && !this.reduced) {
      this.pop.value = 0.15;
      const { unit } = this.geometry;
      const [x, y] = this.toPixels(col, row);
      this.particles.ring({ x, y, from: unit * 0.12, to: unit * 0.8, life: 0.5, width: 1.6, color: this.palette.ring, alpha: 0.65 });
      for (let index = 0; index < 12; index += 1) {
        const angle = (index / 12) * Math.PI * 2 + random(-0.2, 0.2);
        const speed = unit * random(1.2, 2.8);
        this.particles.spark({
          x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          life: random(0.3, 0.55), size: unit * random(0.06, 0.12), color: pick(this.palette.spark), drag: 4,
        });
      }
    }
    this.render();
    this.wake();
  }

  // A real move: the ball shoots off in one direction and slams into whatever stops it.
  launch(target, { direction, slideMs, fresh }) {
    if (this.slide) this.land(true);
    const [stepRow, stepCol] = DIRECTION_STEPS[direction] ?? [0, 0];
    const start = performance.now();
    // The squares this slide paints, and when (the same timings the tiles light up on).
    const paints = Object.entries(fresh ?? {})
      .map(([key, delay]) => {
        const [row, col] = key.split('-').map(Number);
        return { row, col, at: start + delay };
      })
      .sort((first, second) => first.at - second.at);
    const distance = Math.abs(target.col - this.x) + Math.abs(target.row - this.y);
    this.slide = {
      fromX: this.x,
      fromY: this.y,
      toX: target.col,
      toY: target.row,
      stepRow,
      stepCol,
      start,
      duration: slideMs,
      ease: SLIDE_EASE,
      paints,
      sparks: 1,
      // Long slides hit harder.
      strength: Math.min(1, 0.45 + distance * 0.1),
      impact: true,
    };
    this.axis = stepCol !== 0 ? 'x' : 'y';
    this.wake();
  }

  // Undo: the ball eases back to where it was, leaving a little shimmer behind.
  glide(target, duration) {
    if (this.slide) this.land(true);
    if (!this.reduced) {
      const { unit } = this.geometry;
      const [x, y] = this.toPixels(this.x, this.y);
      this.particles.ring({ x, y, from: unit * 0.75, to: unit * 0.1, life: 0.35, width: 1.4, color: pick(this.palette.rewind), alpha: 0.6 });
      for (let index = 0; index < 7; index += 1) {
        this.particles.spark({
          x: x + unit * random(-0.25, 0.25), y: y + unit * random(-0.25, 0.25),
          vx: unit * random(-0.4, 0.4), vy: -unit * random(0.3, 1),
          life: random(0.35, 0.6), size: unit * random(0.05, 0.1), color: pick(this.palette.rewind), drag: 2, twinkle: 0.5,
        });
      }
    }
    const deltaX = target.col - this.x;
    const deltaY = target.row - this.y;
    this.slide = {
      fromX: this.x,
      fromY: this.y,
      toX: target.col,
      toY: target.row,
      stepRow: Math.sign(deltaY),
      stepCol: Math.sign(deltaX),
      start: performance.now(),
      duration,
      ease: UNDO_EASE,
      paints: [],
      sparks: 0.35,
      strength: 0.3,
      impact: false,
    };
    this.axis = Math.abs(deltaX) >= Math.abs(deltaY) ? 'x' : 'y';
    this.wake();
  }

  // A move into a wall it is already against: the ball squishes into it and bounces back.
  bump(direction) {
    if (this.reduced) return;
    const [stepRow, stepCol] = DIRECTION_STEPS[direction] ?? [0, 0];
    this.offsetX.velocity += stepCol * 3.6;
    this.offsetY.velocity += stepRow * 3.6;
    const [along, across] = stepCol !== 0 ? [this.scaleX, this.scaleY] : [this.scaleY, this.scaleX];
    along.velocity -= 5.5;
    across.velocity += 4;
    this.splash(stepRow, stepCol, 0.35, ['#ffffff', '#ffd2c4', '#c9d6df']);
    this.wake();
  }

  // The board is cleared. A finished level (`big`) also sends a ripple of light over every square.
  celebrate(cells, big) {
    if (this.reduced) return;
    // Wait for the ball to arrive, so the burst comes from where the last square was painted.
    if (this.slide) {
      this.pendingCelebration = { cells, big };
      return;
    }
    this.burst(cells, big);
  }

  // ---------- Effects ----------

  // The ball hits a wall at the end of a slide.
  impact(stepRow, stepCol, strength) {
    if (this.reduced) return;
    // Momentum carries it a touch into the wall before it springs back...
    this.offsetX.velocity += stepCol * 2.6 * strength;
    this.offsetY.velocity += stepRow * 2.6 * strength;
    // ...and it squashes flat against it, then wobbles back to round.
    const [along, across] = stepCol !== 0 ? [this.scaleX, this.scaleY] : [this.scaleY, this.scaleX];
    along.velocity -= 7.5 * strength;
    across.velocity += 5.5 * strength;
    this.splash(stepRow, stepCol, strength, this.palette.spark);
  }

  // Sparks off the wall the ball hit, and a shockwave flattened along it.
  splash(stepRow, stepCol, strength, colors) {
    const { unit } = this.geometry;
    const [x, y] = this.toPixels(this.x + stepCol * (RADIUS + 0.1), this.y + stepRow * (RADIUS + 0.1));
    const back = Math.atan2(-stepRow, -stepCol);
    const count = Math.round(6 + 12 * strength);
    for (let index = 0; index < count; index += 1) {
      // Most bounce back off the wall; some skid along it.
      const skid = Math.random() < 0.35;
      const angle = skid
        ? back + (Math.random() < 0.5 ? 1 : -1) * random(1.2, 1.5)
        : back + random(-1, 1) * random(0.2, 1.1);
      const speed = unit * random(1.6, 4.6) * (0.5 + strength * 0.5);
      this.particles.spark({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: random(0.22, 0.48), size: unit * random(0.05, 0.11), color: pick(colors), drag: 5,
      });
    }
    this.particles.ring({
      x, y, from: unit * 0.08, to: unit * (0.4 + 0.3 * strength), life: 0.36, width: 1.6,
      color: this.palette.ring, alpha: 0.2 + 0.5 * strength, squash: 0.3, angle: stepCol !== 0 ? Math.PI / 2 : 0,
    });
  }

  // A square lights up under the ball: a soft bloom and a few sparks.
  paintBurst(row, col) {
    if (this.reduced) return;
    const { unit } = this.geometry;
    const [x, y] = this.toPixels(col, row);
    this.particles.spark({ x, y, life: 0.3, size: unit * 0.4, endSize: unit * 0.62, color: pick(this.palette.paint), alpha: 0.32, drag: 0 });
    for (let index = 0; index < 4; index += 1) {
      const angle = random(0, Math.PI * 2);
      const speed = unit * random(0.8, 2.4);
      this.particles.spark({
        x: x + Math.cos(angle) * unit * 0.15, y: y + Math.sin(angle) * unit * 0.15,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: random(0.3, 0.55), size: unit * random(0.05, 0.1), color: pick(this.palette.paint), drag: 4,
      });
    }
  }

  // Sparks shed behind the ball as it rolls.
  trail(lastX, lastY, moved, rate) {
    const { unit } = this.geometry;
    const directionX = (this.x - lastX) / moved;
    const directionY = (this.y - lastY) / moved;
    const wanted = moved * 6 * rate;
    const count = Math.floor(wanted) + (Math.random() < wanted % 1 ? 1 : 0);
    for (let index = 0; index < count; index += 1) {
      const along = Math.random();
      const side = random(-1, 1) * RADIUS * 0.75;
      const [x, y] = this.toPixels(
        lastX + (this.x - lastX) * along - directionX * RADIUS * 0.5 - directionY * side,
        lastY + (this.y - lastY) * along - directionY * RADIUS * 0.5 + directionX * side,
      );
      const back = unit * random(0.3, 1.6);
      const drift = unit * random(-0.9, 0.9);
      this.particles.spark({
        x, y, vx: -directionX * back - directionY * drift, vy: -directionY * back + directionX * drift,
        life: random(0.22, 0.5), size: unit * random(0.05, 0.12), color: pick(this.palette.spark), drag: 3.5, alpha: 0.9,
      });
    }
  }

  // Restart: the ball bursts where it was before popping back in at the start.
  poof() {
    if (this.reduced) return;
    const { unit } = this.geometry;
    const [x, y] = this.toPixels(this.x + this.offsetX.value, this.y + this.offsetY.value);
    this.particles.ring({ x, y, from: unit * 0.2, to: unit * 0.9, life: 0.4, width: 1.8, color: this.palette.spark[2], alpha: 0.6 });
    for (let index = 0; index < 16; index += 1) {
      const angle = random(0, Math.PI * 2);
      const speed = unit * random(1.5, 3.8);
      this.particles.spark({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: random(0.3, 0.6), size: unit * random(0.07, 0.14), color: pick(this.palette.spark), drag: 4,
      });
    }
  }

  // The board is cleared: fireworks from the ball, and for a level a wave of light over the board.
  burst(cells, big) {
    const { unit } = this.geometry;
    const [x, y] = this.toPixels(this.x + this.offsetX.value, this.y + this.offsetY.value);
    const count = big ? 64 : 36;
    for (let index = 0; index < count; index += 1) {
      const angle = random(0, Math.PI * 2);
      const speed = unit * random(1.8, big ? 8 : 6);
      this.particles.spark({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: random(0.55, big ? 1.25 : 0.85), size: unit * random(0.07, 0.19), color: pick(this.palette.burst),
        drag: 2.4, gravity: unit * 1.2, twinkle: 0.5,
      });
    }
    this.particles.ring({ x, y, from: unit * 0.3, to: unit * (big ? 2.8 : 1.9), life: 0.65, width: 2.4, color: this.palette.ring, alpha: 0.85 });
    this.particles.ring({ x, y, from: unit * 0.2, to: unit * (big ? 1.8 : 1.3), life: 0.55, width: 1.6, color: pick(this.palette.paint), alpha: 0.7, delay: 0.09 });
    // The ball swells with it and wobbles back.
    this.pop.velocity += 6;
    this.scaleX.velocity += 3;
    this.scaleY.velocity -= 3;
    if (cells) {
      // Timed to the brightest moment of each tile's celebrate animation (see game-view.css).
      const now = performance.now();
      for (const [row, col] of cells) {
        this.scheduled.push({ at: now + 300 + (row + col) * 28, row, col });
      }
    }
    this.wake();
  }

  // Motes of light drifting up off a square, for the end-of-level ripple.
  motes(row, col) {
    const { unit } = this.geometry;
    const [x, y] = this.toPixels(col, row);
    for (let index = 0; index < 2; index += 1) {
      this.particles.spark({
        x: x + unit * random(-0.3, 0.3), y: y + unit * random(-0.3, 0.3),
        vx: unit * random(-0.3, 0.3), vy: -unit * random(0.5, 1.3),
        life: random(0.6, 1), size: unit * random(0.07, 0.14), color: pick(this.palette.paint), drag: 1.2, twinkle: 0.6,
      });
    }
  }

  // A slide is over: the ball reaches its square (or is cut short by the next move) and hits.
  land(interrupted) {
    const { slide } = this;
    this.slide = null;
    for (const paint of slide.paints) this.paintBurst(paint.row, paint.col);
    if (!interrupted) {
      this.x = slide.toX;
      this.y = slide.toY;
    }
    if (slide.impact) {
      this.impact(slide.stepRow, slide.stepCol, slide.strength * (interrupted ? 0.55 : 1));
    } else {
      this.scaleX.velocity -= 3 * slide.strength;
      this.scaleY.velocity += 3 * slide.strength;
    }
    if (this.pendingCelebration) {
      const { cells, big } = this.pendingCelebration;
      this.pendingCelebration = null;
      this.burst(cells, big);
    }
  }

  // ---------- The frame loop ----------

  wake() {
    if (this.frame || this.destroyed) return;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  tick(now) {
    this.frame = 0;
    if (this.destroyed) return;
    const seconds = clamp((now - this.lastTime) / 1000, 0, 0.05);
    this.lastTime = now;
    this.update(now, seconds);
    this.render();
    if (this.busy()) this.frame = requestAnimationFrame(this.tick);
  }

  busy() {
    return Boolean(this.slide)
      || this.particles.count > 0
      || this.scheduled.length > 0
      || this.speed > 0.02
      || Math.hypot(this.x - this.tailX, this.y - this.tailY) > 0.01
      || !springAtRest(this.scaleX, 1)
      || !springAtRest(this.scaleY, 1)
      || !springAtRest(this.offsetX, 0)
      || !springAtRest(this.offsetY, 0)
      || !springAtRest(this.pop, 1);
  }

  update(now, seconds) {
    const lastX = this.x;
    const lastY = this.y;
    const { slide } = this;
    const sparkRate = slide?.sparks ?? 1;
    if (slide) {
      while (slide.paints.length && slide.paints[0].at <= now) {
        const paint = slide.paints.shift();
        this.paintBurst(paint.row, paint.col);
      }
      const time = (now - slide.start) / slide.duration;
      if (time >= 1) {
        this.land(false);
      } else {
        const progress = slide.ease.progressAt(time);
        this.x = slide.fromX + (slide.toX - slide.fromX) * progress;
        this.y = slide.fromY + (slide.toY - slide.fromY) * progress;
      }
    }

    // How fast the ball is going, smoothed so the stretch eases in and out.
    const moved = Math.hypot(this.x - lastX, this.y - lastY);
    const speed = seconds > 0 ? moved / seconds : 0;
    this.speed += (speed - this.speed) * (1 - Math.exp(-seconds * 30));
    if (moved > 0.001 && !this.reduced) this.trail(lastX, lastY, moved, sparkRate);

    // Stretched long along the way it moves, thinner across it.
    const stretch = 1 - Math.exp(-this.speed / 14);
    const along = 1 + 0.25 * stretch;
    const across = 1 - 0.15 * stretch;
    const [targetX, targetY] = this.axis === 'x' ? [along, across] : [across, along];
    let remaining = seconds;
    while (remaining > 1e-6) {
      const step = Math.min(MAX_STEP, remaining);
      remaining -= step;
      stepSpring(this.scaleX, targetX, 420, 12, step);
      stepSpring(this.scaleY, targetY, 420, 12, step);
      stepSpring(this.offsetX, 0, 640, 24, step);
      stepSpring(this.offsetY, 0, 640, 24, step);
      stepSpring(this.pop, 1, 300, 15, step);
    }

    // The comet tail chases the ball, so it trails out on a fast slide and shrinks back as it stops.
    const follow = 1 - Math.exp(-seconds * 16);
    this.tailX += (this.x - this.tailX) * follow;
    this.tailY += (this.y - this.tailY) * follow;
    const tailLength = Math.hypot(this.x - this.tailX, this.y - this.tailY);
    if (tailLength > 2.4) {
      const keep = 2.4 / tailLength;
      this.tailX = this.x - (this.x - this.tailX) * keep;
      this.tailY = this.y - (this.y - this.tailY) * keep;
    }

    if (this.scheduled.length) {
      this.scheduled = this.scheduled.filter((item) => {
        if (item.at > now) return true;
        this.motes(item.row, item.col);
        return false;
      });
    }
    this.particles.step(seconds);
  }

  render() {
    const x = this.x + this.offsetX.value;
    const y = this.y + this.offsetY.value;
    this.playerElement.style.setProperty('--x', x.toFixed(4));
    this.playerElement.style.setProperty('--y', y.toFixed(4));
    const pop = Math.max(0, this.pop.value);
    const scaleX = clamp(this.scaleX.value * pop, 0, 1.9);
    const scaleY = clamp(this.scaleY.value * pop, 0, 1.9);
    this.bodyElement.style.transform = `scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;

    const { context } = this;
    context.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
    if (this.reduced) return;
    // Additive: light adds up, so overlapping glows brighten instead of hiding each other.
    context.globalCompositeOperation = 'lighter';
    this.drawGlow(x, y, pop);
    this.drawTail(x, y, pop);
    this.particles.draw(context);
  }

  // The red light the ball casts on the squares around it, brighter while it moves.
  drawGlow(x, y, pop) {
    const { unit } = this.geometry;
    const stretch = 1 - Math.exp(-this.speed / 14);
    const radius = unit * (1.1 + 0.4 * stretch) * pop;
    if (radius < unit * RADIUS) return;
    const [px, py] = this.toPixels(x, y);
    const [red, green, blue] = this.palette.glow;
    const light = this.context.createRadialGradient(px, py, unit * RADIUS * 0.5, px, py, radius);
    light.addColorStop(0, `rgba(${red}, ${green}, ${blue}, ${0.13 + 0.12 * stretch})`);
    light.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
    this.context.fillStyle = light;
    this.context.fillRect(px - radius, py - radius, radius * 2, radius * 2);
  }

  // A soft comet tail: glows stamped from the ball back to the tail's end, fading and narrowing.
  drawTail(x, y, pop) {
    const length = Math.hypot(this.x - this.tailX, this.y - this.tailY);
    if (length < 0.05) return;
    const { unit } = this.geometry;
    const [headX, headY] = this.toPixels(x, y);
    const [endX, endY] = this.toPixels(this.tailX, this.tailY);
    const pixels = Math.hypot(headX - endX, headY - endY);
    const width = unit * RADIUS * 2 * Math.min(1, pop);
    const strength = Math.min(1, length / 0.7);
    const stamps = Math.min(28, Math.ceil(pixels / (width * 0.22)));
    const sprite = glowSprite(this.palette.tail);
    for (let index = 0; index <= stamps; index += 1) {
      const share = index / stamps;
      const size = width * (1 - share * 0.8) * HALO * 0.62;
      this.context.globalAlpha = 0.16 * strength * (1 - share) ** 1.3;
      this.context.drawImage(sprite, headX + (endX - headX) * share - size / 2, headY + (endY - headY) * share - size / 2, size, size);
    }
    this.context.globalAlpha = 1;
  }
}
