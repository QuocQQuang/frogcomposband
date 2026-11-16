// Strict Pixel Overhaul Atlas & 5-Buffer Pipeline
// - MASTER_PALETTES & #141019 universal shadow base
// - Non-destructive Flood-Fill 16x16 Remasterer (remasterLegacyTileSafe)
// - Toroidal Voronoi Cobblestone Floor & Biome Generators (no checkerboards/polka-dots)
// - All 7 Frogcomposband Wall/Ore Vein/Rubble Generators
// - Hand-crafted 2D Pixel Art Bitmap Templates (no geometric circle/ellipse blobs)

export const SHADOW_BASE_HEX = 0x141019;

const _len = Math.hypot(-0.55, -0.65, 0.52);
export const LIGHT_VEC = [-0.55 / _len, -0.65 / _len, 0.52 / _len];

export const BAYER_4X4 = [
  0 / 16,  8 / 16,  2 / 16, 10 / 16,
  12 / 16, 4 / 16, 14 / 16,  6 / 16,
  3 / 16, 11 / 16,  1 / 16,  9 / 16,
  15 / 16, 7 / 16, 13 / 16,  5 / 16,
];

export const MASTER_PALETTES = {
  0:  null,
  1:  [0x1b1926, 0x2f2d40, 0x4e4d66, 0x767894, 0xa8b0c4], // Dungeon Stone (Cool Grey-Blue)
  2:  [0x172026, 0x283840, 0x41585e, 0x658385, 0x9ab5b0], // Ancient Crypt / Quartz Stone
  3:  [0x21131a, 0x3d2224, 0x633931, 0x8f5843, 0xba835e], // Timber / Warm Wood
  4:  [0x160f19, 0x291a21, 0x452b2e, 0x694542, 0x8f6657], // Dark Basalt / Rotten Wood / Dirt
  5:  [0x131f21, 0x1e3830, 0x325e43, 0x568f56, 0x92c474], // Moss / Slime / Reptile Green
  6:  [0x141621, 0x262b3d, 0x424c66, 0x6c7d9e, 0xa8bee0], // Forged Iron
  7:  [0x181c2b, 0x2f3852, 0x526185, 0x8699bf, 0xd4e2fc], // High Steel / Mithril
  8:  [0x2b1719, 0x59311e, 0x9c6027, 0xd99f36, 0xfae06b], // Gold / Brass / Holy
  9:  [0x1f141c, 0x45262a, 0x7a443b, 0xb56e53, 0x6ec4a7], // Bronze / Copper
  10: [0x24151c, 0x422629, 0x6e423b, 0x9c654f, 0xc79473], // Leather / Beast Fur
  11: [0x261f29, 0x4a3e47, 0x7d6e6d, 0xb5a79a, 0xe8dec8], // Bone / Undead / Parchment
  12: [0x291521, 0x522938, 0x8a4853, 0xc47672, 0xf2b39b], // Humanoid Flesh / Warm Skin
  13: [0x1f0b1c, 0x4a1228, 0x871c33, 0xc93640, 0xff8078], // Crimson Blood / Fire / Magma
  14: [0x12132e, 0x242966, 0x3b5dc9, 0x54a2ff, 0xb8f2ff], // Arcane / Mana / Frost / Quartz Glow
  15: [0x1d1128, 0x3c1f54, 0x6b338c, 0xa855c7, 0xefb0ff], // Eldritch / Chaos / Nether
  16: [0x261a0d, 0x593e16, 0x9e7424, 0xdeb841, 0xffff99], // Acid / Venom / Lightning / Amber
};

const PALETTE_RGB = {};
for (const [idStr, ramp] of Object.entries(MASTER_PALETTES)) {
  const id = Number(idStr);
  if (!ramp) continue;
  PALETTE_RGB[id] = ramp.map((hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]);
}

function createPRNG(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) * 0.5;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

export function classifyRGBToMaterial(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s < 0.14) {
    if (l > 0.68) return 11;
    if (b > r + 10) return 7;
    if (l < 0.25) return 4;
    return 1;
  }
  if (h < 18 || h >= 338) {
    if (l > 0.62 && s < 0.65) return 12;
    if (s < 0.45 && l < 0.48) return 3;
    return 13;
  }
  if (h < 38) return l > 0.58 && s > 0.55 ? 8 : (s < 0.52 ? 10 : 3);
  if (h < 68) return l > 0.62 || s > 0.72 ? 8 : 16;
  if (h < 158) return 5;
  if (h < 198) return s < 0.42 ? 2 : 14;
  if (h < 252) return s < 0.35 ? 6 : 14;
  if (h < 318) return 15;
  return 12;
}

export function attrToMaterial(dAttr, fallback = 10) {
  switch (dAttr & 0x0f) {
    case 1: return 11;
    case 2: return 1;
    case 3: return 16;
    case 4: return 13;
    case 5: return 5;
    case 6: return 14;
    case 7: return 3;
    case 8: return 6;
    case 9: return 7;
    case 10: return 15;
    case 11: return 8;
    case 12: return 13;
    case 13: return 5;
    case 14: return 14;
    case 15: return 10;
    default: return fallback;
  }
}

// ============================================================================
// 1. 5-BUFFER PIXEL SURFACE
// ============================================================================

export class PixelSurface {
  constructor(width, height) {
    this.w = width;
    this.h = height;
    const len = width * height;
    this.mat = new Uint8Array(len);
    this.height = new Float32Array(len);
    this.nx = new Float32Array(len);
    this.ny = new Float32Array(len);
    this.nz = new Float32Array(len);
    this.toneBias = new Int8Array(len);
    this.emissive = new Uint8Array(len);
  }

  setPixel(x, y, matId, h, nx, ny, nz, bias = 0, emissive = 0) {
    x = x | 0;
    y = y | 0;
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const idx = y * this.w + x;
    if (matId === 0) {
      this.mat[idx] = 0;
      this.height[idx] = 0;
      return;
    }
    if (this.mat[idx] !== 0 && h < this.height[idx]) return;
    const nLen = Math.hypot(nx, ny, nz) || 1;
    this.mat[idx] = matId;
    this.height[idx] = h;
    this.nx[idx] = nx / nLen;
    this.ny[idx] = ny / nLen;
    this.nz[idx] = nz / nLen;
    this.toneBias[idx] = Math.max(-2, Math.min(2, bias));
    this.emissive[idx] = emissive ? 1 : 0;
  }

  applyBevelAndAO() {
    const w = this.w, h = this.h;
    const newBias = new Int8Array(this.toneBias);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (this.mat[idx] === 0) continue;

        const topEmpty = y === 0 || this.mat[(y - 1) * w + x] === 0;
        const leftEmpty = x === 0 || this.mat[y * w + (x - 1)] === 0;
        const ndotl = this.nx[idx] * LIGHT_VEC[0] + this.ny[idx] * LIGHT_VEC[1] + this.nz[idx] * LIGHT_VEC[2];

        if ((topEmpty || leftEmpty) && ndotl > -0.15) {
          newBias[idx] = Math.min(2, newBias[idx] + 1);
        }

        let ao = false;
        if (y > 0) {
          const nIdx = (y - 1) * w + x;
          if (this.mat[nIdx] !== 0 && this.height[nIdx] > this.height[idx] + 0.5) ao = true;
        }
        if (!ao && x > 0) {
          const nIdx = y * w + (x - 1);
          if (this.mat[nIdx] !== 0 && this.height[nIdx] > this.height[idx] + 0.5) ao = true;
        }
        if (ao) newBias[idx] = Math.max(-2, newBias[idx] - 1);
      }
    }
    this.toneBias = newBias;
  }

  toCanvas(withSelOut = true) {
    const w = this.w, h = this.h;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(w, h);
    const data = img.data;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const m = this.mat[idx];
        if (m === 0) continue;
        const ramp = PALETTE_RGB[m] || PALETTE_RGB[1];

        let tone;
        if (this.emissive[idx]) {
          tone = this.toneBias[idx] > 0 ? 4 : 3;
        } else {
          const ndotl = this.nx[idx] * LIGHT_VEC[0] + this.ny[idx] * LIGHT_VEC[1] + this.nz[idx] * LIGHT_VEC[2];
          const baseTone = ndotl > 0.62 ? 4 : ndotl > 0.25 ? 3 : ndotl > -0.12 ? 2 : ndotl > -0.45 ? 1 : 0;
          tone = Math.max(0, Math.min(4, baseTone + this.toneBias[idx]));
        }
        const [r, g, b] = ramp[tone];
        const p = idx * 4;
        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = b;
        data[p + 3] = 255;
      }
    }

    if (withSelOut) {
      const outlineMask = new Uint8Array(w * h);
      const outlineColor = new Uint32Array(w * h);

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (this.mat[idx] !== 0) continue;

          const nUp = y > 0 ? this.mat[(y - 1) * w + x] : 0;
          const nDn = y < h - 1 ? this.mat[(y + 1) * w + x] : 0;
          const nLt = x > 0 ? this.mat[y * w + (x - 1)] : 0;
          const nRt = x < w - 1 ? this.mat[y * w + (x + 1)] : 0;
          if (!nUp && !nDn && !nLt && !nRt) continue;

          const filledAdj = (nUp ? 1 : 0) + (nDn ? 1 : 0) + (nLt ? 1 : 0) + (nRt ? 1 : 0);
          if (filledAdj === 1 && (nRt !== 0 || nDn !== 0)) {
            const adjMat = nRt || nDn;
            const ramp = PALETTE_RGB[adjMat] || PALETTE_RGB[1];
            const [rr, gg, bb] = ramp[1];
            outlineMask[idx] = 1;
            outlineColor[idx] = (rr << 16) | (gg << 8) | bb;
          } else {
            outlineMask[idx] = 1;
            outlineColor[idx] = SHADOW_BASE_HEX;
          }
        }
      }

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (!outlineMask[idx]) continue;
          const cUp = y > 0 && outlineMask[(y - 1) * w + x];
          const cDn = y < h - 1 && outlineMask[(y + 1) * w + x];
          const cLt = x > 0 && outlineMask[y * w + (x - 1)];
          const cRt = x < w - 1 && outlineMask[y * w + (x + 1)];
          const hasCardFilled =
            (y > 0 && this.mat[(y - 1) * w + x] !== 0) ||
            (y < h - 1 && this.mat[(y + 1) * w + x] !== 0) ||
            (x > 0 && this.mat[y * w + (x - 1)] !== 0) ||
            (x < w - 1 && this.mat[y * w + (x + 1)] !== 0);
          if (!hasCardFilled && ((cUp && cLt) || (cUp && cRt) || (cDn && cLt) || (cDn && cRt))) {
            continue;
          }
          const col = outlineColor[idx];
          const p = idx * 4;
          data[p] = (col >> 16) & 255;
          data[p + 1] = (col >> 8) & 255;
          data[p + 2] = col & 255;
          data[p + 3] = 255;
        }
      }
    }

    ctx.putImageData(img, 0, 0);
    return canvas;
  }
}

// ============================================================================
// 2. NON-DESTRUCTIVE 16x16 LEGACY TILE REMASTERING (Flood-Fill Preserved)
// ============================================================================

export function remasterLegacyTileSafe(srcImageData, targetSurface) {
  const w = srcImageData.width, h = srcImageData.height;
  const src = srcImageData.data;

  // Step 1: Identify TRUE exterior background via Flood-Fill from the 4 corners
  const isBg = new Uint8Array(w * h);
  const queue = [];

  const isBgColor = (idx) => {
    const a = src[idx * 4 + 3];
    const r = src[idx * 4], g = src[idx * 4 + 1], b = src[idx * 4 + 2];
    return a < 32 || (r < 8 && g < 8 && b < 8);
  };

  for (let x = 0; x < w; x++) {
    if (isBgColor(x)) { isBg[x] = 1; queue.push(x); }
    const bot = (h - 1) * w + x;
    if (isBgColor(bot) && !isBg[bot]) { isBg[bot] = 1; queue.push(bot); }
  }
  for (let y = 0; y < h; y++) {
    const left = y * w;
    if (isBgColor(left) && !isBg[left]) { isBg[left] = 1; queue.push(left); }
    const right = y * w + (w - 1);
    if (isBgColor(right) && !isBg[right]) { isBg[right] = 1; queue.push(right); }
  }

  while (queue.length > 0) {
    const curr = queue.pop();
    const cx = curr % w, cy = (curr / w) | 0;
    const neighbors = [
      cy > 0 ? curr - w : -1,
      cy < h - 1 ? curr + w : -1,
      cx > 0 ? curr - 1 : -1,
      cx < w - 1 ? curr + 1 : -1,
    ];
    for (const n of neighbors) {
      if (n >= 0 && !isBg[n] && isBgColor(n)) {
        isBg[n] = 1;
        queue.push(n);
      }
    }
  }

  // Step 2: Every pixel NOT reached by the exterior flood-fill is 100% solid anatomy!
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!isBg[i]) mask[i] = 1;
  }

  const offX = (targetSurface.w - w) >> 1;
  const offY = targetSurface.h > h ? (targetSurface.h - h - 1) : ((targetSurface.h - h) >> 1);

  // Step 3: Re-light while preserving 100% of the original pixel-art contrast & details
  for (let y = 0; y < h; y++) {
    let xMin = w, xMax = -1;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
      }
    }
    if (xMax < xMin) continue;
    const span = Math.max(1, xMax - xMin);

    for (let x = xMin; x <= xMax; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;

      const r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2];
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const matId = classifyRGBToMaterial(r, g, b);

      const u = ((x - xMin) / span) * 2 - 1;
      const v = (y / h) * 2 - 1;
      const nx = u * 0.55;
      const ny = v * 0.35;
      const nz = Math.sqrt(Math.max(0.2, 1 - nx * nx - ny * ny));

      const bias = Math.round((lum - 0.48) * 4.5);
      targetSurface.setPixel(offX + x, offY + y, matId, 2.5, nx, ny, nz, bias);
    }
  }
  targetSurface.applyBevelAndAO();
}

// ============================================================================
// 3. TOROIDAL VORONOI COBBLESTONE FLOOR & BIOMES (ZERO POLKA-DOTS / CHECKERBOARDS)
// ============================================================================

export function generateVoronoiCobbleFloor(surface, seed = 101, mossChance = 0.12, matId = 1) {
  const W = surface.w, H = surface.h;
  const rng = createPRNG(seed);

  // 8 toroidal Voronoi cell centers
  const pts = [];
  for (let i = 0; i < 8; i++) {
    pts.push({
      x: rng() * W,
      y: rng() * H,
      hBias: rng() > 0.55 ? 1 : (rng() < 0.25 ? -1 : 0),
      moss: rng() < mossChance,
    });
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let d1 = 1e9, d2 = 1e9;
      let best = pts[0], bestDx = 0, bestDy = 0;

      for (const p of pts) {
        // Wrap distance toroidally across [-W..W, -H..H]
        let dx = x - p.x;
        let dy = y - p.y;
        if (dx > W * 0.5) dx -= W;
        else if (dx < -W * 0.5) dx += W;
        if (dy > H * 0.5) dy -= H;
        else if (dy < -H * 0.5) dy += H;

        const d = Math.hypot(dx, dy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          best = p;
          bestDx = dx;
          bestDy = dy;
        } else if (d < d2) {
          d2 = d;
        }
      }

      const gap = d2 - d1;
      if (gap < 1.35) {
        // Recessed cobblestone crack / sparse moss in joint
        const useMoss = best.moss && gap < 0.95;
        surface.setPixel(x, y, useMoss ? 5 : matId, 0.8, 0, 0.4, 0.8, useMoss ? -1 : -2);
      } else {
        const edgeBevel = gap < 2.15 && (bestDx < 0 || bestDy < 0) ? 1 : 0;
        const nx = (bestDx / (W * 0.35)) * 0.45;
        const ny = (bestDy / (H * 0.35)) * 0.45;
        const nz = Math.sqrt(Math.max(0.4, 1 - nx * nx - ny * ny));
        surface.setPixel(x, y, matId, 1.4, nx, ny, nz, best.hBias + edgeBevel - 1);
      }
    }
  }
}

export function generateBiomeFloor(surface, biome, seed = 101, frame = 0) {
  const W = surface.w, H = surface.h;
  if (biome === "water" || biome === "deepwater") {
    const mat = biome === "deepwater" ? 14 : 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const w = Math.sin((x + frame * 3) * 0.48 + Math.cos(y * 0.52) * 1.4);
        const crest = w > 0.78;
        surface.setPixel(x, y, mat, 1.0, w * 0.35, -0.35, 0.85, crest ? 1 : (biome === "deepwater" ? -1 : 0));
      }
    }
    return;
  }
  if (biome === "lava") {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = Math.sin((x + frame * 2) * 0.42 + y * 0.25) + Math.cos(y * 0.46 - x * 0.2);
        const hot = v > 0.65;
        surface.setPixel(x, y, hot ? 16 : 13, 1.0, v * 0.25, -0.3, 0.85, hot ? 1 : 0, hot ? 1 : 0);
      }
    }
    return;
  }
  if (biome === "grass") {
    generateVoronoiCobbleFloor(surface, seed, 0.65, 5);
    return;
  }
  if (biome === "crypt") {
    generateVoronoiCobbleFloor(surface, seed, 0.08, 2);
    return;
  }
  generateVoronoiCobbleFloor(surface, seed, 0.12, 1);
}

// ============================================================================
// 4. COMPLETE FROGCOMPOSBAND WALL & ORE VEIN GENERATOR (ALL 7 TYPES)
// ============================================================================

export function generateFrogWallOrVein(surface, wallType = "granite", hasSouthFloor = true, seed = 101) {
  const W = surface.w, H = surface.h;

  const isMagma = wallType.startsWith("magma");
  const isQuartz = wallType.startsWith("quartz");
  const hasTreasure = wallType.endsWith("_gold") || wallType.includes("treasure");
  const isPerm = wallType === "permanent";
  const isRubble = wallType === "rubble";

  // 7. RUBBLE: Pile of collapsed broken boulders on top of Voronoi cobblestone floor
  if (isRubble) {
    generateVoronoiCobbleFloor(surface, seed, 0.15);
    const boulders = [
      { cx: W * 0.35, cy: H * 0.62, r: W * 0.20, h: 3.0 },
      { cx: W * 0.68, cy: H * 0.65, r: W * 0.18, h: 3.2 },
      { cx: W * 0.50, cy: H * 0.42, r: W * 0.22, h: 4.0 },
      { cx: W * 0.28, cy: H * 0.38, r: W * 0.14, h: 2.8 },
      { cx: W * 0.72, cy: H * 0.40, r: W * 0.15, h: 2.9 },
    ];
    for (const b of boulders) {
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const dx = x - b.cx, dy = y - b.cy;
          const dist = Math.hypot(dx, dy) + Math.sin(x * 1.3 + y * 1.7) * 0.6;
          if (dist < b.r) {
            const nx = dx / b.r, ny = dy / b.r;
            const nz = Math.sqrt(Math.max(0.15, 1 - nx * nx - ny * ny));
            surface.setPixel(x, y, 1, b.h + nz, nx, ny, nz, dist > b.r - 1.1 && nx < 0 ? 1 : 0);
          }
        }
      }
    }
    surface.applyBevelAndAO();
    return;
  }

  // Granite=1, Magma=4, Quartz=2, Permanent=6
  const baseMat = isPerm ? 6 : isMagma ? 4 : isQuartz ? 2 : 1;
  const capH = hasSouthFloor ? Math.floor(H * 0.44) : H;

  // 1. Staggered Masonry (Granite/Permanent) or Craggy Volcanic Rock (Magma/Quartz)
  for (let y = 0; y < H; y++) {
    const isTopCap = y < capH;
    const courseH = isTopCap ? 6 : Math.max(5, Math.floor((H - capH) / 3));
    const row = Math.floor((isTopCap ? y : y - capH) / courseH);
    const localY = (isTopCap ? y : y - capH) % courseH;
    const stagger = (row % 2) * Math.floor(W * 0.38);
    const brickW = Math.floor(W * 0.5);

    for (let x = 0; x < W; x++) {
      const localX = (x + stagger) % brickW;
      const warp = (isMagma || isQuartz) ? Math.round(Math.sin(x * 0.7 + y * 0.9 + seed) * 1.2) : 0;
      const isMortar = ((localY + warp) === 0) || ((localX + warp) === 0);

      if (isPerm && (y === 0 || y === capH - 1 || y === H - 1 || x === 0 || x === W - 1)) {
        const isRivet = (x % 6 === 3) && (y === 1 || y === capH - 2);
        surface.setPixel(x, y, isRivet ? 8 : 9, 6.5, 0, -0.5, 0.8, isRivet ? 2 : 1);
      } else if (y === capH - 1 && hasSouthFloor) {
        surface.setPixel(x, y, baseMat, 6.0, 0, -0.6, 0.8, 2);
      } else if (isMortar) {
        if (isMagma && ((x + y + seed) % 3 === 0)) {
          surface.setPixel(x, y, 13, 3.2, 0, 0, 1, 1, 1); // Glowing magma fissure
        } else {
          surface.setPixel(x, y, baseMat, 2.8, 0, 0.5, 0.8, -2);
        }
      } else {
        const nx = (localX === 1) ? -0.45 : (localX === brickW - 1 ? 0.35 : 0.0);
        const ny = isTopCap ? -0.25 : ((localY === 1) ? -0.55 : 0.2);
        const ao = (!isTopCap && y >= H - 2) ? -1 : (isTopCap ? -1 : 0);
        surface.setPixel(x, y, baseMat, isTopCap ? 5.2 : 4.2, nx, ny, 0.8, ao);
      }
    }
  }

  // 2. Overlay Quartz Crystal Clusters
  if (isQuartz) {
    const crystals = [
      { cx: W * 0.32, cy: H * 0.65, dx: -2, dy: -5 },
      { cx: W * 0.48, cy: H * 0.70, dx: 1,  dy: -6 },
      { cx: W * 0.65, cy: H * 0.62, dx: 3,  dy: -4 },
      { cx: W * 0.45, cy: H * 0.25, dx: -1, dy: -3 },
    ];
    for (const c of crystals) {
      for (let t = 0; t <= 1.0; t += 0.15) {
        const px = Math.round(c.cx + c.dx * t);
        const py = Math.round(c.cy + c.dy * t);
        surface.setPixel(px, py, 14, 5.8, -0.6, -0.6, 0.5, t > 0.6 ? 2 : 1);
        surface.setPixel(px + 1, py, 11, 5.6, 0.5, -0.3, 0.8, 2);
      }
    }
  }

  // 3. Overlay Rich Gold / Treasure Nuggets
  if (hasTreasure) {
    const veins = [
      { x: W * 0.28, y: H * 0.58 }, { x: W * 0.34, y: H * 0.62 },
      { x: W * 0.55, y: H * 0.72 }, { x: W * 0.62, y: H * 0.68 },
      { x: W * 0.48, y: H * 0.54 }, { x: W * 0.40, y: H * 0.22 },
      { x: W * 0.66, y: H * 0.28 },
    ];
    for (const v of veins) {
      const gx = Math.round(v.x), gy = Math.round(v.y);
      surface.setPixel(gx,     gy,     8, 6.2, -0.6, -0.7, 0.4, 2, 1);
      surface.setPixel(gx + 1, gy,     8, 6.1,  0.3, -0.4, 0.8, 1);
      surface.setPixel(gx,     gy + 1, 8, 6.0, -0.3,  0.4, 0.8, 1);
      surface.setPixel(gx + 1, gy + 1, 8, 5.9,  0.5,  0.5, 0.7, -1);
    }
  }
}

// ============================================================================
// 5. HAND-CRAFTED 2D PIXEL ART BITMAP TEMPLATES (NO GEOMETRIC BLOBS!)
// ============================================================================

export const PIXEL_TEMPLATES = {
  paladin_16: [
    "......GGGG......",
    ".....GSSSSG.....",
    "....SSSSSSSS....",
    "....IIEIIEII..B.",
    "....SSSSSSSS..BB",
    "...CCGGGGGGCC.B.",
    "..CCSSSSSSSSCCB.",
    "..CCSSGGGGSSCC..",
    "..CCSSSSSSSSGG..",
    "..CCCLLLLLLCCC..",
    "...CCLLLLLLCC...",
    "...C.LL..LL.C...",
    ".....II..II.....",
    ".....SS..SS.....",
    "....LLL..LLL....",
    "................",
  ],

  mage_16: [
    ".......EE.......",
    "......EEEE......",
    ".....CCCCCC.....",
    "....CCCCCCCC....",
    "...CCCEIIECCC.G.",
    "....CCSSSSCC..W.",
    "...CCCEEEECCC.W.",
    "..CCCCCCCCCCCCW.",
    "..CCSSGGGGSSCCW.",
    "..CCCCCCCCCCCCW.",
    "..CCCCCCCCCCC.W.",
    "...CCCCCCCCCC.W.",
    "...CCC....CCC...",
    "....LL....LL....",
    "...LLL....LLL...",
    "................",
  ],

  ranger_16: [
    "................",
    ".....GGGGGG.....",
    "....GGGGGGGG....",
    "....LLEIILLE..W.",
    "....LLLLLLLL.W.S",
    "...CCLLLLLLCCW.S",
    "..CCLLLLLLLLCW.S",
    "..CCLLGGGGLLCW.S",
    "..CCLLLLLLLLCW.S",
    "...CLLLLLLLLC.W.",
    "....LL....LL....",
    "....LL....LL....",
    "....II....II....",
    "...LLL....LLL...",
    "................",
    "................",
  ],

  orc_raider_16: [
    "..I........I....",
    "..II.IIII.II..B.",
    "...IIIIIIII..BB.",
    "...IGERGREGI.B..",
    "....GGGGGGGG.B..",
    "..LLLLLLLLLLLL..",
    ".SSLLLLLLLLLL...",
    "SSGSLLLLLLLL....",
    "SSGSLLLLLLL.....",
    ".SS.LLLLLLL.....",
    "....GGG..GGG....",
    "....GGG..GGG....",
    "....LLL..LLL....",
    "...LLLL..LLL....",
    "................",
    "................",
  ],

  troll_brute_16: [
    "....II....II....",
    "...GGGGGGGGGG...",
    "...GGRGGGGGGR...",
    "..GGGGGGGGGGGG..",
    ".LLGGGGGGGGGGLL.",
    ".LLLLGGGGGGLLLL.",
    "WWLLLLGGGGLLLL..",
    "WW.LLLLLLLLLL...",
    "W..LLLLLLLLLL...",
    "...LLLL..LLLL...",
    "...GGGG..GGGG...",
    "...GGGG..GGGG...",
    "...IIII..IIII...",
    "..LLLLL..LLLLL..",
    "................",
    "................",
  ],

  dragon_16: [
    ".CC..........CC.",
    "CCCC..I..I..CCCC",
    "CCCSSGSSSSG.CCC.",
    ".CC..GGRGGR..CC.",
    ".CC..GGGGGG.....",
    ".....GGGGGGG....",
    "....GGGGGGGG....",
    "...GGGSSSSGGG...",
    "..GGGGSSSSGGGG..",
    "..GGGGSSSSGGGGC.",
    "...GGGSSSSGG.CC.",
    "....GG....GG..C.",
    "....II....II....",
    "...SSS....SSS...",
    "................",
    "................",
  ],

  hound_16: [
    "................",
    "................",
    "..I..I..........",
    ".GGGGGG.........",
    "GRGGGGGG........",
    "GGGGSGGGGGGGG...",
    "..GGGGGGGGGGGG.G",
    "...GGGGGGGGGGGG.",
    "...GGGGGGGGGG...",
    "...GGG....GGG...",
    "...GG......GG...",
    "...GG......GG...",
    "..III......III..",
    "................",
    "................",
    "................",
  ],

  spider_16: [
    "................",
    "..I..........I..",
    ".I..I..RR..I..I.",
    "I..I.GGGGGG.I..I",
    "..I.GGGGGGGG.I..",
    ".I.GGGGGGGGGG.I.",
    "I..GG.GGGG.GG..I",
    "...G..GGGG..G...",
    "..I..GGGGGG..I..",
    ".I....GGGG....I.",
    "I......II......I",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],

  lich_16: [
    ".....G....G.....",
    "....GGGGGGGG....",
    "....SSSESESS....",
    ".....SSSSSS...E.",
    "....CCCCCCCC..W.",
    "...CCSS..SSCC.W.",
    "..CCC..SS..CCCW.",
    "..CCCSSSSSSC..W.",
    "..CCC..SS..CC.W.",
    "..CCCCCCCCCCC.W.",
    "...CCCCCCCCCC...",
    "...CC.CCCC.CC...",
    "..CC...CC...CC..",
    "..C..........C..",
    "................",
    "................",
  ],

  beholder_16: [
    "..E....E....E...",
    "...G..GGG..G....",
    "....GGGGGGG.....",
    "...GGGGGGGGG....",
    "..GGGSSSSSGGG...",
    "..GGSSRERSSGG...",
    "..GGGSSSSSGGG...",
    "..GGGGGGGGGGG...",
    "...GGGGGGGGG....",
    "....GGSSGGG.....",
    "....G..G..G.....",
    "...G...G...G....",
    "................",
    "................",
    "................",
    "................",
  ],

  slime_16: [
    "................",
    "................",
    "......GGGG......",
    "....GGGGGGGG....",
    "...GGGSSGGGGG...",
    "..GGGGSSGGGGGG..",
    "..GGGGGGGGGGGG..",
    ".GGGGGGGGGGGGGG.",
    ".GGGGGIIGGGGGGG.",
    ".GGGGGGGGGGGGGG.",
    ".GGGGGGGGGGGGGG.",
    "..GGGGGGGGGGGG..",
    "...GGGGGGGGGG...",
    "................",
    "................",
    "................",
  ],

  chest_16: [
    "................",
    "................",
    "...IIIIIIIIII...",
    "..IWWWWWWWWWWII.",
    ".IWWWWWWWWWWWWII",
    ".IWWIIIIIIIIWWII",
    ".IIIIIIIIIIIIIII",
    ".IWWWWGGGGWWWWII",
    ".IWWWWGIIIGWWWII",
    ".IWWWWGGGGWWWWII",
    ".IWWIIIIIIIIWWII",
    ".IWWWWWWWWWWWWII",
    "..IIIIIIIIIIIII.",
    "................",
    "................",
    "................",
  ],

  door_closed_16: [
    "..IIIIIIIIIIII..",
    ".IIWWWWWWWWWWII.",
    ".IIWWWWWWWWWWII.",
    ".IIWWWWWWWWWWII.",
    ".IIIIIIIIIIIIII.",
    ".IIWWWWWWWWWWII.",
    ".IIWWWWWWWWGGII.",
    ".IIWWWWWWWWGGII.",
    ".IIWWWWWWWWWWII.",
    ".IIIIIIIIIIIIII.",
    ".IIWWWWWWWWWWII.",
    ".IIWWWWWWWWWWII.",
    ".IIWWWWWWWWWWII.",
    ".IIWWWWWWWWWWII.",
    "................",
    "................",
  ],

  door_open_16: [
    "..IIIIIIIIIIII..",
    ".II..........II.",
    ".IIW.........II.",
    ".IIWW........II.",
    ".IIWW........II.",
    ".IIWW........II.",
    ".IIWG........II.",
    ".IIWW........II.",
    ".IIWW........II.",
    ".IIWW........II.",
    ".IIWW........II.",
    ".IIWW........II.",
    ".IIW.........II.",
    ".II..........II.",
    "................",
    "................",
  ],

  stairs_down_16: [
    "..IIIIIIIIIIII..",
    ".IISSSSSSSSSSII.",
    ".II..........II.",
    ".II..SSSSSS..II.",
    ".II..IIIIII..II.",
    ".II...SSSS...II.",
    ".II...IIII...II.",
    ".II....SS....II.",
    ".II..........II.",
    ".II..........II.",
    ".II..........II.",
    ".II..........II.",
    ".IIIIIIIIIIIIII.",
    "................",
    "................",
    "................",
  ],

  stairs_up_16: [
    "..IIIIIIIIIIII..",
    ".II..........II.",
    ".II....SS....II.",
    ".II...SSSS...II.",
    ".II..SSSSSS..II.",
    ".II..IIIIII..II.",
    ".II.SSSSSSSS.II.",
    ".II.IIIIIIII.II.",
    ".IISSSSSSSSSSII.",
    ".IIIIIIIIIIIIII.",
    ".IISSSSSSSSSSII.",
    ".IIIIIIIIIIIIII.",
    ".IIIIIIIIIIIIII.",
    "................",
    "................",
    "................",
  ],

  potion_16: [
    "......WWWW......",
    "......WWWW......",
    ".......SS.......",
    "......SSSS......",
    ".....SSGGSS.....",
    "....SGGGGGGS....",
    "...SGGGGGGGGS...",
    "...SGGSSGGGGS...",
    "...SGGSSGGGGS...",
    "...SGGGGGGGGS...",
    "...SGGGGGGGGS...",
    "....SGGGGGGS....",
    ".....SSSSSS.....",
    "................",
    "................",
    "................",
  ],

  scroll_16: [
    "................",
    ".........SSSS...",
    "........SSWWSS..",
    ".......SSWWWWSS.",
    "......SSWWWWWW..",
    ".....SSWWWWWW...",
    "....SSWWRRWW....",
    "...SSWWRRWW.....",
    "..SSWWWWWW......",
    ".SSWWWWWW.......",
    ".SSWWSS.........",
    "..SSSS..........",
    "................",
    "................",
    "................",
    "................",
  ],

  sword_16: [
    ".............BB.",
    "............BBB.",
    "...........BBB..",
    "..........BBB...",
    ".........BBB....",
    "........BBB.....",
    ".......BBB......",
    "......BBB.......",
    "....GGBB........",
    ".....GGG........",
    "....LL.GG.......",
    "...LL...........",
    "..GG............",
    "................",
    "................",
    "................",
  ],

  gold_16: [
    "................",
    "................",
    ".......GGGG.....",
    "......GSSSSG....",
    ".....GGGGGGGG...",
    "....GGGG..GGGG..",
    "...GSSSS..GSSSS.",
    "...GGGGGGGGGGGG.",
    "..GGGG.GGGG.GGGG",
    "..GSSS.GSSS.GSSS",
    "..GGGG.GGGG.GGGG",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
};

export function renderPixelTemplate(surface, templateRows, customPaletteOverrides = {}, yOffsetExtra = 0) {
  const H = templateRows.length;
  const W = templateRows[0].length;
  const offX = (surface.w - W) >> 1;
  const offY = ((surface.h - H) >> 1) + yOffsetExtra;

  const CHAR_MAP = {
    S: { mat: 7,  h: 4.0, bias: 1, em: 0 },
    I: { mat: 6,  h: 3.5, bias: 0, em: 0 },
    G: { mat: 8,  h: 4.5, bias: 1, em: 0 },
    C: { mat: 13, h: 2.0, bias: 0, em: 0 },
    L: { mat: 10, h: 3.0, bias: 0, em: 0 },
    W: { mat: 3,  h: 3.2, bias: 0, em: 0 },
    B: { mat: 7,  h: 5.0, bias: 2, em: 0 },
    E: { mat: 14, h: 4.8, bias: 2, em: 1 },
    R: { mat: 13, h: 4.8, bias: 2, em: 1 },
  };

  for (let y = 0; y < H; y++) {
    const row = templateRows[y];
    let xMin = W, xMax = -1;
    for (let x = 0; x < W; x++) {
      if (row[x] !== ".") {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
      }
    }
    if (xMax < xMin) continue;
    const span = Math.max(1, xMax - xMin);

    for (let x = 0; x < W; x++) {
      const ch = row[x];
      if (ch === ".") continue;
      const spec = CHAR_MAP[ch];
      if (!spec) continue;

      const matId = customPaletteOverrides[ch] || spec.mat;
      const u = ((x - xMin) / span) * 2 - 1;
      const v = (y / H) * 2 - 1;
      const nx = u * 0.6;
      const ny = v * 0.35;
      const nz = Math.sqrt(Math.max(0.2, 1 - nx * nx - ny * ny));

      surface.setPixel(offX + x, offY + y, matId, spec.h, nx, ny, nz, spec.bias, spec.em);
    }
  }
  surface.applyBevelAndAO();
}

// ============================================================================
// 6. TEXTURE ATLAS CACHE MANAGER
// ============================================================================

export class StrictAtlasManager {
  constructor() {
    this.cache = new Map();
    this.legacy16Canvas = null;
    this.legacy16Ctx = null;
    this.legacy16Ready = false;

    this.contactShadow = this.buildContactShadow(24, 10);
    this.wallDropShadow = this.buildWallDropShadow(24, 4);
  }

  attachLegacy16Image(img) {
    if (!img || !img.complete || img.naturalWidth === 0) return;
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    this.legacy16Canvas = c;
    this.legacy16Ctx = ctx;
    this.legacy16Ready = true;
  }

  buildContactShadow(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const sr = (SHADOW_BASE_HEX >> 16) & 255;
    const sg = (SHADOW_BASE_HEX >> 8) & 255;
    const sb = SHADOW_BASE_HEX & 255;
    const cx = w * 0.5, cy = h * 0.55, rx = w * 0.38, ry = h * 0.36;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > 1.0) continue;
        const bayer2x2 = ((x & 1) * 2 + (y & 1)) / 4;
        const density = 1.0 - dist2;
        if (density > 0.45 || density > bayer2x2 * 0.55) {
          const p = (y * w + x) * 4;
          d[p] = sr; d[p + 1] = sg; d[p + 2] = sb; d[p + 3] = 153;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  buildWallDropShadow(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const sr = (SHADOW_BASE_HEX >> 16) & 255;
    const sg = (SHADOW_BASE_HEX >> 8) & 255;
    const sb = SHADOW_BASE_HEX & 255;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (y >= 2 && ((x + y) & 1) !== 0) continue;
        const p = (y * w + x) * 4;
        d[p] = sr; d[p + 1] = sg; d[p + 2] = sb; d[p + 3] = y < 2 ? 155 : 100;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  getFloor(biome, variant = 0, frame = 0) {
    const key = `floor:${biome}:${variant}:${frame}`;
    let c = this.cache.get(key);
    if (!c) {
      const s = new PixelSurface(24, 24);
      generateBiomeFloor(s, biome, 101 + variant * 37, frame);
      c = s.toCanvas(false);
      this.cache.set(key, c);
    }
    return c;
  }

  getWall(wallType, hasSouthFloor, variant = 0) {
    const key = `wall:${wallType}:${hasSouthFloor ? 1 : 0}:${variant}`;
    let c = this.cache.get(key);
    if (!c) {
      const s = new PixelSurface(24, 24);
      generateFrogWallOrVein(s, wallType, hasSouthFloor, 200 + variant * 53);
      c = s.toCanvas(false);
      this.cache.set(key, c);
    }
    return c;
  }

  getRemastered16(row, col, outW = 24, outH = 24) {
    if (!this.legacy16Ready) return null;
    const key = `rem16:${row}:${col}:${outW}x${outH}`;
    let c = this.cache.get(key);
    if (c) return c;

    const sx = col * 16, sy = row * 16;
    if (sx + 16 > this.legacy16Canvas.width || sy + 16 > this.legacy16Canvas.height) return null;
    const imgData = this.legacy16Ctx.getImageData(sx, sy, 16, 16);
    const s = new PixelSurface(outW, outH);
    remasterLegacyTileSafe(imgData, s);
    c = s.toCanvas(true);
    this.cache.set(key, c);
    return c;
  }

  getTemplate(name, overrides = {}, outW = 24, outH = 24, yShift = 0) {
    const ovKey = Object.entries(overrides).map(([k, v]) => `${k}=${v}`).join(",");
    const key = `tpl:${name}:${ovKey}:${outW}x${outH}:${yShift}`;
    let c = this.cache.get(key);
    if (!c) {
      const rows = PIXEL_TEMPLATES[name];
      if (!rows) return null;
      const s = new PixelSurface(outW, outH);
      renderPixelTemplate(s, rows, overrides, yShift);
      c = s.toCanvas(true);
      this.cache.set(key, c);
    }
    return c;
  }

  getPlayerSprite(pclass = 0, frame = 0) {
    const f = frame % 2;
    let tpl = "paladin_16";
    if ([2, 5, 10, 12].includes(pclass)) tpl = "mage_16";
    else if ([3, 6].includes(pclass)) tpl = "ranger_16";
    return this.getTemplate(tpl, {}, 24, 30, f === 1 ? 1 : 0);
  }

  getMonsterSprite(dChar, dAttr = 1, xAttr = 0, xChar = 0, frame = 0, preferTemplate = true) {
    const f = frame % 2;
    const yShift = f === 1 ? 1 : 0;
    const ch = typeof dChar === "number" ? String.fromCharCode(dChar) : (dChar || "o");
    const mat = attrToMaterial(dAttr, 5);

    if (preferTemplate) {
      if (ch === "o" || ch === "k") return this.getTemplate("orc_raider_16", { G: mat }, 24, 30, yShift);
      if (ch === "T" || ch === "P" || ch === "O") return this.getTemplate("troll_brute_16", { G: mat }, 24, 30, yShift);
      if (ch === "D" || ch === "d" || ch === "M") return this.getTemplate("dragon_16", { G: mat, C: mat }, 24, 30, yShift);
      if (ch === "C" || ch === "f" || ch === "Z") return this.getTemplate("hound_16", { G: mat }, 24, 30, yShift);
      if (ch === "S" || ch === "a" || ch === "I") return this.getTemplate("spider_16", { G: mat }, 24, 30, yShift);
      if (ch === "L" || ch === "V" || ch === "s" || ch === "z" || ch === "W") return this.getTemplate("lich_16", { C: mat }, 24, 30, yShift);
      if (ch === "e") return this.getTemplate("beholder_16", { G: mat }, 24, 30, yShift);
      if (ch === "j" || ch === "m" || ch === ",") return this.getTemplate("slime_16", { G: mat }, 24, 30, yShift);
    }

    // Connectivity-preserving 16x16 remaster fallback
    if ((xAttr & 0x80) && (xChar & 0x80)) {
      const rem = this.getRemastered16(xAttr & 0x7f, xChar & 0x7f, 24, 30);
      if (rem) return rem;
    }

    return this.getTemplate("orc_raider_16", { G: mat }, 24, 30, yShift);
  }

  getItemSprite(tval, dAttr = 1, xAttr = 0, xChar = 0, preferTemplate = true) {
    const mat = attrToMaterial(dAttr, 8);
    if (preferTemplate) {
      if (tval === 7) return this.getTemplate("chest_16", {}, 24, 24);
      if (tval === 75 || tval === 2) return this.getTemplate("potion_16", { G: mat }, 24, 24);
      if (tval === 70 || tval === 69) return this.getTemplate("scroll_16", {}, 24, 24);
      if (tval >= 20 && tval <= 23) return this.getTemplate("sword_16", {}, 24, 24);
      if (tval === 127) return this.getTemplate("gold_16", {}, 24, 24);
    }
    if ((xAttr & 0x80) && (xChar & 0x80)) {
      const rem = this.getRemastered16(xAttr & 0x7f, xChar & 0x7f, 24, 24);
      if (rem) return rem;
    }
    return this.getTemplate("chest_16", {}, 24, 24);
  }
}
