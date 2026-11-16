// FrogRemasterAtlas.js — Master 5-Buffer Procedural Pixel Engine (procedural-roguelike-world-art)
// 1. Hue-Shifted 18-Material Library (PALETTES 0..17, including 17: quietFloor)
// 2. 5-Buffer Deferred PixelSurface (mat, height, nx/ny/nz, toneBias, applyBevelAndAO, stampBitmapGrid, renderToCanvas)
// 3. Bresenham & L-Corner Cleanup + Quiet Floors + All 7 Frogcomposband Wall/Ore Vein Generators
// 4. 10 Master Hand-Pixelled Creature Archetype Grids + 4 DNA Bitfield Mutations
// 5. Parametric NMM Item & Equipment Recipes (45-deg Weapons, Armor, Meniscus Potions, Scrolls, Rings, 3-Plane Chests)
// 6. Non-destructive remaster16xSprite() preserved for 16px Fix mode

export const PALETTES = {
  0:  null,
  1:  [0x1b1926, 0x2f2d40, 0x4e4d66, 0x767894, 0xa8b0c4], // stone (Granite / Cool Grey-Blue)
  2:  [0x172026, 0x283840, 0x41585e, 0x658385, 0x9ab5b0], // ancientStone (Crypt Slate / Quartz Rock)
  3:  [0x21131a, 0x3d2224, 0x633931, 0x8f5843, 0xba835e], // wood (Warm Timber)
  4:  [0x160f19, 0x291a21, 0x452b2e, 0x694542, 0x8f6657], // darkWood (Basalt / Magma Rock / Dark Dirt)
  5:  [0x141621, 0x262b3d, 0x424c66, 0x6c7d9e, 0xa8bee0], // iron (Forged Dark Metal)
  6:  [0x181c2b, 0x2f3852, 0x526185, 0x8699bf, 0xd4e2fc], // steel (High Steel / Mithril Blade)
  7:  [0x2b1719, 0x59311e, 0x9c6027, 0xd99f36, 0xfae06b], // gold (Pure Gold / Brass / Treasure Vein)
  8:  [0x1f141c, 0x45262a, 0x7a443b, 0xb56e53, 0x6ec4a7], // copper (Bronze / Verdigris Shine)
  9:  [0x24151c, 0x422629, 0x6e423b, 0x9c654f, 0xc79473], // leather (Beast Hide / Brown Fur)
  10: [0x261f29, 0x4a3e47, 0x7d6e6d, 0xb5a79a, 0xe8dec8], // bone (Undead Skull / Ivory / Fangs / Parchment)
  11: [0x1f0b1c, 0x4a1228, 0x871c33, 0xc93640, 0xff8078], // crimson (Blood / Red Dragon / Magma / Health Potion)
  12: [0x12132e, 0x242966, 0x3b5dc9, 0x54a2ff, 0xb8f2ff], // arcaneCrystal (Mana / Frost / Quartz Crystal)
  13: [0x131f21, 0x1e3830, 0x325e43, 0x568f56, 0x92c474], // emeraldMoss (Orc/Troll Skin / Venom / Acid Slime)
  14: [0x291521, 0x522938, 0x8a4853, 0xc47672, 0xf2b39b], // flesh (Humanoid Skin / Living Tissue)
  15: [0x1d1128, 0x3c1f54, 0x6b338c, 0xa855c7, 0xefb0ff], // eldritch (Arch-Lich Robe / Chaos / Beholder)
  16: [0x261a0d, 0x593e16, 0x9e7424, 0xdeb841, 0xffff99], // solarFlame (Fire Core / Lightning / Glowing Eyes)
  17: [0x151320, 0x1c1a29, 0x242234, 0x2e2b40, 0x3a3750], // quietFloor (Dedicated Low-Contrast Calm Dungeon Floor)
};

export function createPRNG(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const BAYER_4X4 = [
   0 / 16 - 0.5,  8 / 16 - 0.5,  2 / 16 - 0.5, 10 / 16 - 0.5,
  12 / 16 - 0.5,  4 / 16 - 0.5, 14 / 16 - 0.5,  6 / 16 - 0.5,
   3 / 16 - 0.5, 11 / 16 - 0.5,  1 / 16 - 0.5,  9 / 16 - 0.5,
  15 / 16 - 0.5,  7 / 16 - 0.5, 13 / 16 - 0.5,  5 / 16 - 0.5,
];

function hashStr32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Map Frogcomposband 16-color d_attr -> PALETTES material ID
function attrToPaletteMat(dAttr, fallback = 13) {
  switch (dAttr & 0x0f) {
    case 1:  return 10; // White -> Bone/Ivory
    case 2:  return 1;  // Slate -> Stone
    case 3:  return 16; // Orange -> SolarFlame/Amber
    case 4:  return 11; // Red -> Crimson
    case 5:  return 13; // Green -> EmeraldMoss
    case 6:  return 12; // Blue -> ArcaneCrystal
    case 7:  return 3;  // Umber -> Wood
    case 8:  return 5;  // L_Dark -> Iron
    case 9:  return 6;  // L_White -> Steel
    case 10: return 15; // Violet -> Eldritch
    case 11: return 7;  // Yellow -> Gold
    case 12: return 11; // L_Red -> Crimson
    case 13: return 13; // L_Green -> EmeraldMoss
    case 14: return 12; // L_Blue -> ArcaneCrystal
    case 15: return 9;  // L_Umber -> Leather
    default: return fallback;
  }
}

// ============================================================================
// 1. 5-BUFFER DEFERRED PIXEL SURFACE
// ============================================================================

export class PixelSurface {
  constructor(width, height) {
    this.w = width;
    this.h = height;
    const size = width * height;
    this.mat = new Uint8Array(size);
    this.height = new Float32Array(size);
    this.nx = new Float32Array(size);
    this.ny = new Float32Array(size);
    this.nz = new Float32Array(size);
    this.toneBias = new Int8Array(size);
  }

  idx(x, y) { return (y | 0) * this.w + (x | 0); }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

  setPixel(x, y, matId, h, nx, ny, nz, bias = 0) {
    const ix = Math.round(x), iy = Math.round(y);
    if (!this.inBounds(ix, iy)) return;
    const i = this.idx(ix, iy);
    if (this.mat[i] !== 0 && h < this.height[i]) return;
    this.mat[i] = matId;
    this.height[i] = h;
    const len = Math.hypot(nx, ny, nz) || 1;
    this.nx[i] = nx / len;
    this.ny[i] = ny / len;
    this.nz[i] = nz / len;
    this.toneBias[i] = Math.max(-3, Math.min(3, Math.round(bias)));
  }

  // Integer Bresenham Line Algorithm
  drawBresenhamLine(x0, y0, x1, y1, matId, h, nx, ny, nz, bias = 0) {
    x0 = Math.round(x0); y0 = Math.round(y0);
    x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.setPixel(x0, y0, matId, h, nx, ny, nz, bias);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  applyBevelAndAO() {
    const nextBias = new Int8Array(this.toneBias);
    for (let y = 1; y < this.h - 1; y++) {
      for (let x = 1; x < this.w - 1; x++) {
        const i = this.idx(x, y);
        if (this.mat[i] === 0) continue;
        const iLt = this.idx(x - 1, y), iUp = this.idx(x, y - 1);
        if ((this.mat[iLt] === 0 || this.mat[iUp] === 0) && (this.nx[i] <= 0.15 || this.ny[i] <= 0.15)) {
          nextBias[i] = Math.min(3, nextBias[i] + 1);
        }
        if ((this.mat[iLt] !== 0 && this.height[iLt] > this.height[i] + 0.45) ||
            (this.mat[iUp] !== 0 && this.height[iUp] > this.height[i] + 0.45)) {
          nextBias[i] = Math.max(-3, nextBias[i] - 1);
        }
      }
    }
    this.toneBias.set(nextBias);
  }

  // Stamp a Hand-Pixelled Bitmap Grid with automatic 2.5D Scanline Normals & Z-Layering
  stampBitmapGrid(gridRows, layerSpecMap, offX = 0, offY = 0) {
    const gh = gridRows.length, gw = gridRows[0].length;
    for (let y = 0; y < gh; y++) {
      const row = gridRows[y];
      let xMin = gw, xMax = -1;
      for (let x = 0; x < gw; x++) {
        if (row[x] !== ".") {
          if (x < xMin) xMin = x;
          if (x > xMax) xMax = x;
        }
      }
      if (xMax < xMin) continue;
      const span = Math.max(1, xMax - xMin);

      for (let x = 0; x < gw; x++) {
        const ch = row[x];
        if (ch === ".") continue;
        const spec = layerSpecMap[ch];
        if (!spec) continue;
        const u = ((x - xMin) / span) * 2 - 1;
        const v = (y / gh) * 2 - 1;
        const nx = u * 0.68;
        const ny = v * 0.38;
        const nz = Math.sqrt(Math.max(0.18, 1 - nx * nx - ny * ny));
        const texMod = spec.textured && ((x + y) % 3 === 0) ? 1 : 0;
        this.setPixel(offX + x, offY + y, spec.mat, spec.h, nx, ny, nz, (spec.bias || 0) + texMod);
      }
    }
  }

  renderToCanvas(ctx, paletteTable = PALETTES, options = { outline: true, ditherStrength: 0.0 }) {
    const img = ctx.createImageData(this.w, this.h);
    const data = new Uint32Array(img.data.buffer);
    const lx = -0.55, ly = -0.65, lz = 0.52;
    const toABGR = (hex) => 0xFF000000 | ((hex & 0xFF) << 16) | (hex & 0xFF00) | ((hex >> 16) & 0xFF);

    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.idx(x, y);
        const m = this.mat[i];
        if (m === 0) continue;
        const ramp = paletteTable[m] || paletteTable[1];
        const ndotl = Math.max(0, this.nx[i] * lx + this.ny[i] * ly + this.nz[i] * lz);
        const bayer = BAYER_4X4[(y & 3) * 4 + (x & 3)] * (options.ditherStrength || 0);
        const tone = Math.max(0, Math.min(4, Math.floor((ndotl + bayer) * 3.9) + this.toneBias[i]));
        data[i] = toABGR(ramp[tone]);
      }
    }

    if (options.outline) {
      const outMask = new Uint8Array(this.w * this.h);
      const outCol = new Uint32Array(this.w * this.h);

      for (let y = 1; y < this.h - 1; y++) {
        for (let x = 1; x < this.w - 1; x++) {
          const i = this.idx(x, y);
          if (this.mat[i] !== 0) continue;
          const nUp = this.mat[this.idx(x, y - 1)], nDn = this.mat[this.idx(x, y + 1)];
          const nLt = this.mat[this.idx(x - 1, y)], nRt = this.mat[this.idx(x + 1, y)];
          const neighborMat = nDn || nRt || nUp || nLt;
          if (neighborMat !== 0) {
            const ramp = paletteTable[neighborMat] || paletteTable[1];
            const isLitEdge = (nDn !== 0 || nRt !== 0) && nUp === 0 && nLt === 0;
            outMask[i] = 1;
            outCol[i] = toABGR(isLitEdge ? ramp[1] : 0x141019);
          }
        }
      }

      // L-Corner Cleanup on diagonal Sel-Out contour
      for (let y = 1; y < this.h - 1; y++) {
        for (let x = 1; x < this.w - 1; x++) {
          const i = this.idx(x, y);
          if (!outMask[i]) continue;
          const nUp = this.mat[this.idx(x, y - 1)], nDn = this.mat[this.idx(x, y + 1)];
          const nLt = this.mat[this.idx(x - 1, y)], nRt = this.mat[this.idx(x + 1, y)];
          const cardCount = (nUp ? 1 : 0) + (nDn ? 1 : 0) + (nLt ? 1 : 0) + (nRt ? 1 : 0);
          const oUp = outMask[this.idx(x, y - 1)], oDn = outMask[this.idx(x, y + 1)];
          const oLt = outMask[this.idx(x - 1, y)], oRt = outMask[this.idx(x + 1, y)];
          // Remove redundant outer corner elbow if it has no cardinal filled support or is purely an elbow
          if (cardCount === 1 && ((oUp && oLt) || (oUp && oRt) || (oDn && oLt) || (oDn && oRt))) {
            // Check diagonal interior pixel opposite to the elbow: only keep if not an outer stair
            if ((oUp && oLt && !nDn && !nRt) || (oUp && oRt && !nDn && !nLt) ||
                (oDn && oLt && !nUp && !nRt) || (oDn && oRt && !nUp && !nLt)) {
              continue;
            }
          }
          data[i] = outCol[i];
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }
}

function surfaceToCanvas(surface, options = { outline: true, ditherStrength: 0.0 }) {
  const c = document.createElement("canvas");
  c.width = surface.w;
  c.height = surface.h;
  const ctx = c.getContext("2d");
  surface.renderToCanvas(ctx, PALETTES, options);
  return c;
}

// ============================================================================
// 2. QUIET FLOORS & ALL 7+ FROGCOMPOSBAND TERRAIN / ORE VEIN GENERATORS
// ============================================================================

function paintQuietFloorOnSurface(s, seed = 1, matId = 17) {
  const W = s.w, H = s.h;
  const rng = createPRNG(seed);
  // Pre-roll row/col seam randomness deterministically
  const rowSeamMask = rng() < 0.72;
  const colSeamMask = rng() < 0.72;

  for (let y = 0; y < H; y++) {
    const row = (y / 8) | 0;
    const stag = (row & 1) * 12;
    for (let x = 0; x < W; x++) {
      const r = rng();
      // 90%+ tone=1 (#1c1a29), ~8% faint slab seam tone=0 (#151320), ~2% fleck tone=2 (#242234)
      const isSeam = (y % 8 === 0 && rowSeamMask && r < 0.48) || ((x + stag) % 12 === 0 && colSeamMask && r < 0.48);
      const isFleck = !isSeam && r < 0.02;
      const bias = isSeam ? -2 : isFleck ? 0 : -1;
      // With nz=0.9 (ndotl*3.9 ~ 1.8 -> tone 1), bias=-1 maps to tone=1, bias=-2 maps to tone=0, bias=0 maps to tone=2
      s.setPixel(x, y, matId, 0.5, 0, 0, 1, bias);
    }
  }
}

export function generateCleanTerrainTile(featureType, tileW = 24, tileH = 24, seed = 1, hasSouthFloor = true) {
  const s = new PixelSurface(tileW, tileH);

  if (featureType === "floor") {
    paintQuietFloorOnSurface(s, seed, 17);
    return surfaceToCanvas(s, { outline: false, ditherStrength: 0.0 });
  }

  if (featureType === "dirt" || featureType === "road") {
    paintQuietFloorOnSurface(s, seed, 4);
    return surfaceToCanvas(s, { outline: false, ditherStrength: 0.0 });
  }

  if (featureType === "grass") {
    paintQuietFloorOnSurface(s, seed, 13);
    // Sparse 2px grass tufts (low-noise)
    const rng = createPRNG(seed + 19);
    for (let i = 0; i < 4; i++) {
      const gx = 3 + Math.floor(rng() * (tileW - 6));
      const gy = 4 + Math.floor(rng() * (tileH - 6));
      s.setPixel(gx, gy, 13, 1.5, -0.3, -0.5, 0.8, 0);
      s.setPixel(gx, gy - 1, 13, 1.6, -0.4, -0.6, 0.7, 1);
    }
    return surfaceToCanvas(s, { outline: false, ditherStrength: 0.0 });
  }

  if (featureType === "water" || featureType === "deepwater" || featureType === "lava") {
    const isLava = featureType === "lava";
    const isDeep = featureType === "deepwater";
    for (let y = 0; y < tileH; y++) {
      for (let x = 0; x < tileW; x++) {
        const wv = Math.sin(x * 0.45 + y * 0.3 + seed);
        if (isLava) {
          const mat = wv > 0.78 ? 16 : 11;
          s.setPixel(x, y, mat, 1.0, wv * 0.3, -0.3, 0.85, wv > 0.45 ? 1 : -1);
        } else {
          const mat = isDeep ? 12 : 2;
          s.setPixel(x, y, mat, 1.0, wv * 0.3, -0.3, 0.85, wv > 0.78 ? 1 : (isDeep ? -1 : 0));
        }
      }
    }
    return surfaceToCanvas(s, { outline: false, ditherStrength: 0.0 });
  }

  if (featureType === "tree") {
    paintQuietFloorOnSurface(s, seed, 13);
    const cx = tileW >> 1, cy = tileH >> 1;
    for (let y = cy + 2; y < tileH - 2; y++) {
      for (let x = cx - 2; x <= cx + 2; x++) {
        s.setPixel(x, y, 3, 2.5, (x - cx) * 0.4, -0.15, 0.9, 0);
      }
    }
    for (let y = 2; y <= cy + 4; y++) {
      for (let x = 2; x < tileW - 2; x++) {
        const dx = (x - cx) / (tileW * 0.38);
        const dy = (y - (cy - 2)) / (tileH * 0.36);
        const d2 = dx * dx + dy * dy;
        if (d2 <= 1.0) {
          const nz = Math.sqrt(Math.max(0.15, 1 - d2));
          s.setPixel(x, y, 13, 4.0 + nz, dx * 0.7, dy * 0.7, nz, 0);
        }
      }
    }
    s.applyBevelAndAO();
    return surfaceToCanvas(s, { outline: true, ditherStrength: 0.0 });
  }

  if (featureType.startsWith("wall_") || featureType === "rubble") {
    if (featureType === "rubble") {
      paintQuietFloorOnSurface(s, seed, 17);
      const rocks = [[8, 14, 4], [15, 15, 4], [11, 10, 5], [7, 10, 3], [16, 11, 3]];
      for (const [rx, ry, rr] of rocks) {
        for (let y = ry - rr; y <= ry + rr; y++) {
          for (let x = rx - rr; x <= rx + rr; x++) {
            const dx = (x - rx) / rr, dy = (y - ry) / rr;
            const d2 = dx * dx + dy * dy;
            if (d2 <= 1.0) {
              const nz = Math.sqrt(Math.max(0.15, 1 - d2));
              s.setPixel(x, y, 1, 3.0 + nz, dx * 0.8, dy * 0.8, nz, 0);
            }
          }
        }
      }
      s.applyBevelAndAO();
      return surfaceToCanvas(s, { outline: true, ditherStrength: 0.0 });
    }

    const isMagma  = featureType.includes("magma");
    const isQuartz = featureType.includes("quartz");
    const hasGold  = featureType.includes("gold");
    const isPerm   = featureType.includes("perm");

    const baseMat = isPerm ? 5 : isMagma ? 4 : isQuartz ? 2 : 1;
    const capH = hasSouthFloor ? Math.floor(tileH * 0.45) : tileH;

    for (let y = 0; y < tileH; y++) {
      const isCap = y < capH;
      for (let x = 0; x < tileW; x++) {
        if (isPerm && (y === 0 || y === capH - 1 || y === tileH - 1 || x === 0 || x === tileW - 1)) {
          const isRivet = x % 6 === 0;
          s.setPixel(x, y, isRivet ? 7 : 8, 6.2, -0.3, -0.5, 0.8, isRivet ? 2 : 1);
        } else if (y === capH - 1 && hasSouthFloor) {
          s.setPixel(x, y, baseMat, 6.0, 0, -0.8, 0.6, 1); // 1px cliff rim
        } else if (isCap) {
          const isInnerRim = y === 1 || x === 1 || x === tileW - 2;
          s.setPixel(x, y, baseMat, 5.0, 0, -0.6, 0.8, isInnerRim ? 0 : -1);
        } else {
          const fy = y - capH;
          const courseH = Math.max(5, (tileH - capH) >> 1);
          const row = (fy / courseH) | 0;
          const ly = fy % courseH;
          const lx = (x + (row & 1) * (tileW >> 1)) % (tileW >> 1);

          if (ly === 0 || lx === 0) {
            if (isMagma && ((x + y + seed) % 4 === 0)) {
              s.setPixel(x, y, 11, 3.6, 0, 0, 1, 2); // Glowing magma fissure
            } else {
              s.setPixel(x, y, baseMat, 3.0, 0, 0.5, 0.8, -2);
            }
          } else if (ly === 1) {
            s.setPixel(x, y, baseMat, 4.4, -0.2, -0.5, 0.8, 1);
          } else if (y >= tileH - 2) {
            s.setPixel(x, y, baseMat, 4.0, 0, 0.3, 0.8, -1);
          } else {
            s.setPixel(x, y, baseMat, 4.2, -0.2, 0.1, 0.9, 0);
          }
        }
      }
    }

    if (isQuartz) {
      const pts = [[7, 15], [8, 14], [8, 13], [15, 16], [16, 15], [16, 14], [11, 6], [12, 5]];
      for (const [qx, qy] of pts) {
        s.setPixel(qx, qy, 12, 5.8, -0.6, -0.6, 0.5, 2);
        s.setPixel(qx + 1, qy, 10, 5.7, 0.4, -0.3, 0.8, 2);
      }
    }

    if (hasGold) {
      const nuggets = [[6, 14], [14, 16], [10, 13], [9, 5], [16, 7]];
      for (const [gx, gy] of nuggets) {
        s.setPixel(gx,     gy,     7, 6.2, -0.6, -0.7, 0.4, 2);
        s.setPixel(gx + 1, gy,     7, 6.1,  0.3, -0.4, 0.8, 1);
        s.setPixel(gx,     gy + 1, 7, 6.0, -0.3,  0.4, 0.8, 1);
        s.setPixel(gx + 1, gy + 1, 7, 5.9,  0.5,  0.5, 0.7, -1);
      }
    }

    return surfaceToCanvas(s, { outline: false, ditherStrength: 0.0 });
  }

  if (featureType === "stairs_down" || featureType === "stairs_up") {
    paintQuietFloorOnSurface(s, seed, 17);
    const isDown = featureType === "stairs_down";
    for (let step = 0; step < 4; step++) {
      const sy = 4 + step * 4;
      const sx0 = 4 + (isDown ? step : (3 - step));
      const sx1 = tileW - 4 - (isDown ? (3 - step) : step);
      for (let x = sx0; x < sx1; x++) {
        s.setPixel(x, sy,     1, 3.8 - step * 0.3, -0.2, -0.6, 0.8, 1);
        s.setPixel(x, sy + 1, 1, 3.6 - step * 0.3, 0, -0.2, 0.9, 0);
        s.setPixel(x, sy + 2, 1, 3.2 - step * 0.3, 0, 0.4, 0.8, -1);
        s.setPixel(x, sy + 3, 1, 2.8 - step * 0.3, 0, 0.6, 0.7, -2);
      }
    }
    return surfaceToCanvas(s, { outline: true, ditherStrength: 0.0 });
  }

  if (featureType === "door_closed" || featureType === "door_open") {
    paintQuietFloorOnSurface(s, seed, 17);
    const isOpen = featureType === "door_open";
    for (let y = 2; y < tileH - 1; y++) {
      for (let x = 3; x < tileW - 3; x++) {
        const isFrame = x <= 5 || x >= tileW - 6 || y <= 4;
        if (isFrame) {
          s.setPixel(x, y, 1, 4.0, x <= 5 ? -0.5 : 0.4, -0.3, 0.8, 0);
        } else if (!isOpen) {
          const isBand = y === 9 || y === 17;
          const isSeam = x % 4 === 0;
          s.setPixel(x, y, isBand ? 5 : 3, isBand ? 3.8 : 3.2, -0.2, -0.1, 0.9, isSeam && !isBand ? -1 : 0);
        }
      }
    }
    if (!isOpen) s.setPixel(tileW - 8, 13, 7, 4.8, -0.5, -0.5, 0.7, 2);
    s.applyBevelAndAO();
    return surfaceToCanvas(s, { outline: true, ditherStrength: 0.0 });
  }

  if (featureType === "trap") {
    paintQuietFloorOnSurface(s, seed, 17);
    const cx = tileW >> 1, cy = tileH >> 1;
    s.drawBresenhamLine(cx, cy - 5, cx + 5, cy, 11, 2.5, -0.3, -0.3, 0.9, 2);
    s.drawBresenhamLine(cx + 5, cy, cx, cy + 5, 11, 2.5, -0.3, -0.3, 0.9, 2);
    s.drawBresenhamLine(cx, cy + 5, cx - 5, cy, 11, 2.5, -0.3, -0.3, 0.9, 2);
    s.drawBresenhamLine(cx - 5, cy, cx, cy - 5, 11, 2.5, -0.3, -0.3, 0.9, 2);
    s.setPixel(cx, cy, 16, 3.0, -0.4, -0.4, 0.8, 2);
    return surfaceToCanvas(s, { outline: true, ditherStrength: 0.0 });
  }

  if (featureType === "shop") {
    paintQuietFloorOnSurface(s, seed, 17);
    for (let y = 3; y < tileH - 2; y++) {
      for (let x = 3; x < tileW - 3; x++) {
        if (y < 9) {
          s.setPixel(x, y, ((x >> 1) & 1) ? 11 : 7, 4.5, -0.2, -0.6, 0.8, 0);
        } else if (x >= 9 && x <= 14 && y >= 12) {
          s.setPixel(x, y, 4, 1.5, 0, 0, 1, -2);
        } else {
          s.setPixel(x, y, 3, 3.2, -0.2, 0.1, 0.9, 0);
        }
      }
    }
    s.setPixel(12, 10, 16, 5.0, -0.4, -0.4, 0.8, 2);
    s.applyBevelAndAO();
    return surfaceToCanvas(s, { outline: true, ditherStrength: 0.0 });
  }

  paintQuietFloorOnSurface(s, seed, 17);
  return surfaceToCanvas(s, { outline: false, ditherStrength: 0.0 });
}

// ============================================================================
// 3. 10 MASTER HAND-PIXELLED CREATURE ARCHETYPES + 4 DNA MUTATIONS
// ============================================================================

const CREATURE_GRIDS = {
  humanoid: [
    "................",
    ".....HHHHHH.....",
    "....HHHHHHHH....",
    "....HHEHHEHH....",
    "....HHHHHHHH..W.",
    "...CCAAAAAACC.W.",
    "..CCAAAAAAAAACW.",
    "..CCABBBBBBAACW.",
    "..SSABBBBBBAAS..",
    "..SSAAAAAAAAA...",
    "...CCBBBBBBCC...",
    "...C.BB..BB.C...",
    ".....AA..AA.....",
    ".....BB..BB.....",
    "....AAA..AAA....",
    "................",
  ],
  giant_troll: [
    "....KKKKKKKK....",
    "...HHHHHHHHHH...",
    "...HHEHHHHHEH...",
    "..HHHHHHHHHHHH..",
    ".CCBBBBBBBBBBCC.",
    ".BBBBAAAAAABBBB.",
    "WWBBBBAAAABBBBSS",
    "WW.BBBBBBBBBB.SS",
    "W..BBBBBBBBBB.SS",
    "...BBBB..BBBB...",
    "...AAAA..AAAA...",
    "...BBBB..BBBB...",
    "...AAAA..AAAA...",
    "..BBBB....BBBB..",
    "................",
    "................",
  ],
  dragon_wyrm: [
    ".CC..........CC.",
    "CCCC..K..K..CCCC",
    "CCCAHHHHHHHH.CC.",
    ".CC..HHEHHE..CC.",
    ".CC..HHHHHH.....",
    ".....BBBBBBB....",
    "....BBBBBBBB....",
    "...BBBAAAABBB...",
    "..BBBBAAAABBBB..",
    "..BBBBAAAABBBBC.",
    "...BBBAAAABB.CC.",
    "....BB....BB..C.",
    "....KK....KK....",
    "...BBB....BBB...",
    "................",
    "................",
  ],
  demon_balrog: [
    ".KK..........KK.",
    "CCKK.HHHHHH.KKCC",
    "CCC..HHEEHH..CCC",
    "CC...HHHHHH...CC",
    "CC..AAAAAAAA..CC",
    ".C.BBBBBBBBBB.C.",
    "...BBBBAAAABBWW.",
    "..SSBBBBBBBBWW..",
    "..SS.BBBBBB.W...",
    ".....BB..BB.....",
    "....BBB..BBB....",
    "....AA....AA....",
    "...KKK....KKK...",
    "................",
    "................",
    "................",
  ],
  undead_lich: [
    ".....K....K.....",
    "....KKKKKKKK....",
    "....HHHEHEHH....",
    ".....HHHHHH...S.",
    "....CCCCCCCC..W.",
    "...CCAA..AACC.W.",
    "..CCC..AA..CCCW.",
    "..CCCAAAAAACC.W.",
    "..CCC..AA..CC.W.",
    "..CCCCCCCCCCC.W.",
    "...CCCCCCCCCC...",
    "...CC.CCCC.CC...",
    "..CC...CC...CC..",
    "..C..........C..",
    "................",
    "................",
  ],
  beholder_eye: [
    "..E....E....E...",
    "...K..KKK..K....",
    "....BBBBBBB.....",
    "...BBBBBBBBB....",
    "..BBBAAAAAABBB..",
    "..BBAABEEBAABB..",
    "..BBBAAAAAABBB..",
    "..BBBBBBBBBBB...",
    "...BBBBBBBBB....",
    "....BBAABBB.....",
    "....K..K..K.....",
    "...K...K...K....",
    "................",
    "................",
    "................",
    "................",
  ],
  arachnid_insect: [
    "................",
    "..C..........C..",
    ".C..C..KK..C..C.",
    "C..C.HHHHHH.C..C",
    "..C.HHEHHEHH.C..",
    ".C.BBBBBBBBBB.C.",
    "C..BB.AAAA.BB..C",
    "...B..AAAA..B...",
    "..C..BBBBBB..C..",
    ".C....BBBB....C.",
    "C......CC......C",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  quadruped_hound: [
    "................",
    "................",
    "..K..K..........",
    ".HHHHHH.........",
    "HEHHHHHH........",
    "HHHHABBBBBBBB...",
    "..BBBBBBBBBBBB.C",
    "...BBBBBBBBBBBB.",
    "...BBBBBBBBBB...",
    "...BBB....BBB...",
    "...BB......BB...",
    "...BB......BB...",
    "..KKK......KKK..",
    "................",
    "................",
    "................",
  ],
  serpent_hydra: [
    "...KK....KK.....",
    "..HHHH..HHHH....",
    "..HEHH..HEHH....",
    "...BB....BB.....",
    "....BB..BB......",
    "....BBBBBB......",
    "...BBBAAABBB....",
    "..BBBBAAABBBB...",
    "..BBBBAAABBBB...",
    "...BBBBBBBBBBC..",
    "....BBBBBBBBCCC.",
    ".....BBBBBBB.CC.",
    ".......CCCC.....",
    "................",
    "................",
    "................",
  ],
  slime_mold: [
    "................",
    "................",
    "......BBBB......",
    "....BBBBBBBB....",
    "...BBBAAAABBB...",
    "..BBBBAAAABBBB..",
    "..BBBBBBBBBBBB..",
    ".BBBBBBBBBBBBBB.",
    ".BBBBBEBEBBBBBB.",
    ".BBBBBBBBBBBBBB.",
    ".BBBBBBBBBBBBBB.",
    "..BBBBBBBBBBBB..",
    "...BBBBBBBBBB...",
    "................",
    "................",
    "................",
  ],
};

function selectArchetype(ch) {
  if (ch === "@" || "phtokn".includes(ch)) return "humanoid";
  if ("TPOH".includes(ch)) return "giant_troll";
  if ("Dd".includes(ch)) return "dragon_wyrm";
  if ("uU".includes(ch)) return "demon_balrog";
  if ("LVWGsz".includes(ch)) return "undead_lich";
  if (ch === "e") return "beholder_eye";
  if ("SaIBcK".includes(ch)) return "arachnid_insect";
  if ("CfZqrg".includes(ch)) return "quadruped_hound";
  if ("JMRwl".includes(ch)) return "serpent_hydra";
  if ("jm,vE".includes(ch)) return "slime_mold";
  return "humanoid";
}

function mutateCreatureGrid(baseRows, dna, isPlayer) {
  const rows = baseRows.map((r) => r.split(""));
  const headDna = isPlayer ? (dna % 4) : (dna & 7) % 6;
  const weapDna = (dna >>> 3) % 6;
  const wingDna = (dna >>> 6) % 5;

  // DNA 2: Head & Crest Mutation on top rows y = 0..4
  if (headDna === 0) {
    rows[0][4] = "K"; rows[0][11] = "K"; rows[1][5] = "K"; rows[1][10] = "K"; // Swept Horns
  } else if (headDna === 1) {
    rows[0][6] = "K"; rows[0][8] = "K"; rows[0][9] = "K"; // Spiked Crown
  } else if (headDna === 2) {
    rows[0][7] = "K"; rows[0][8] = "K"; rows[1][7] = "K"; // Plumed Knight Helm
  } else if (headDna === 3) {
    rows[0][7] = "C"; rows[0][8] = "C"; rows[1][6] = "C"; rows[1][9] = "C"; // Pointed Hood
  } else if (headDna === 4) {
    rows[3][5] = "K"; rows[3][10] = "K"; // Tusks
  }

  // DNA 3: Weapon & Offhand Mutation
  if (weapDna === 1) {
    // Double-Bit Battleaxe
    for (let y = 2; y <= 9; y++) rows[y][14] = "W";
    rows[2][13] = "W"; rows[3][13] = "W"; rows[2][15] = "W"; rows[3][15] = "W";
  } else if (weapDna === 2) {
    // Spiked Greatclub
    for (let y = 3; y <= 9; y++) rows[y][14] = "W";
    rows[3][13] = "K"; rows[4][15] = "K";
  } else if (weapDna === 3) {
    // Arcane Gem Staff + Floating Orb
    for (let y = 3; y <= 12; y++) rows[y][14] = "W";
    rows[2][14] = "E"; rows[6][2] = "S"; rows[7][2] = "E";
  } else if (weapDna === 4) {
    // Dual Daggers
    for (let y = 5; y <= 8; y++) { rows[y][14] = "W"; rows[y][1] = "W"; }
  } else if (weapDna === 5) {
    // Flaming Scourge / Spear
    for (let y = 1; y <= 11; y++) rows[y][14] = "W";
    rows[1][13] = "E"; rows[2][15] = "E";
  }

  // DNA 4: Wing / Tail / Cloak Mutation
  if (wingDna === 0 && rows[3][1] === ".") {
    rows[2][1] = "C"; rows[3][1] = "C"; rows[3][2] = "C";
    rows[2][14] = "C"; rows[3][14] = "C"; rows[3][13] = "C";
  } else if (wingDna === 3) {
    rows[1][2] = "E"; rows[10][13] = "E"; // Orbiting Runes
  }

  return rows.map((r) => r.join(""));
}

export function synthesizeCreatureSprite(category, charCode, dAttr = 1, entityId = 0, size = 24) {
  const ch = typeof charCode === "number" ? String.fromCharCode(charCode) : (charCode || "o");
  const isPlayer = category === "player" || ch === "@";
  const dna = hashStr32(`${category}:${ch}:${dAttr}:${entityId}`);

  // DNA 1: Palette DNA
  const matBody = isPlayer ? 6 : attrToPaletteMat(dAttr, 13);
  const matArmor = isPlayer ? 7 : ((dna & 1) ? 5 : 9);
  const matEye = isPlayer ? 12 : (matBody === 11 ? 16 : 11);
  const matBack = isPlayer ? 11 : ((matBody === 11 || matBody === 15) ? 15 : 4);
  const scaly = "DdMJCR".includes(ch) || ((dna >>> 8) & 1) === 1;

  const archetype = isPlayer ? "humanoid" : selectArchetype(ch);
  const mutatedGrid = mutateCreatureGrid(CREATURE_GRIDS[archetype], dna, isPlayer);

  const s = new PixelSurface(size, size);
  const offX = (size - 16) >> 1;
  const offY = (size - 16) >> 1;

  const layerSpecMap = {
    C: { mat: matBack,  h: 1.6, bias: -1 },
    B: { mat: matBody,  h: 3.0, bias: 0, textured: scaly },
    A: { mat: matArmor, h: 3.8, bias: 0 },
    H: { mat: isPlayer ? 6 : matBody, h: 4.4, bias: 0 },
    S: { mat: 8,        h: 4.8, bias: 0 },
    K: { mat: 10,       h: 5.0, bias: 1 },
    W: { mat: 6,        h: 5.4, bias: 1 },
    E: { mat: matEye,   h: 5.6, bias: 2 },
  };

  s.stampBitmapGrid(mutatedGrid, layerSpecMap, offX, offY);
  s.applyBevelAndAO();
  return surfaceToCanvas(s, { outline: true, ditherStrength: 0.0 });
}

// ============================================================================
// 4. PARAMETRIC RECIPES FOR ITEMS, WEAPONS, ARMOR & PROPS (5-BUFFER NMM)
// ============================================================================

export function synthesizeItemSprite(tval, charCode, dAttr = 1, entityId = 0, size = 24) {
  const ch = typeof charCode === "number" ? String.fromCharCode(charCode) : (charCode || "~");
  const seed = hashStr32(`item:${tval}:${ch}:${dAttr}:${entityId}`);
  const mat = attrToPaletteMat(dAttr, 7);
  const s = new PixelSurface(size, size);

  // 1. Weapons (45-deg diagonal: along = x + (H-1-y), across = x - (H-1-y))
  if ((tval >= 19 && tval <= 23) || "|/\\}".includes(ch)) {
    const bladeMat = (dAttr === 11 || dAttr === 3) ? 7 : (seed & 1) ? 6 : 5;
    for (let y = 3; y < size - 3; y++) {
      for (let x = 3; x < size - 3; x++) {
        const along = x + (size - 1 - y);
        const across = x - (size - 1 - y);
        // Hilt & Crossguard around along = 12..16
        if (along >= 9 && along <= 13 && Math.abs(across) <= 1) {
          s.setPixel(x, y, 9, 4.2, across * 0.5, -0.2, 0.8, 0);
        } else if (along >= 14 && along <= 15 && Math.abs(across) <= 4) {
          s.setPixel(x, y, 7, 5.0, across * 0.25, -0.4, 0.85, across < 0 ? 1 : 0);
        } else if (along >= 16 && along <= size * 1.45 && Math.abs(across) <= 2) {
          // 45-deg NMM blade shading
          const nmm = (along % 7 === 0) ? 2 : (across < 0 ? 1 : (across === 0 ? -1 : 0));
          s.setPixel(x, y, bladeMat, 4.0, across * 0.5, -0.4, 0.8, nmm);
        }
      }
    }
    if (tval === 22 || ch === "/") {
      // Axe head extension
      for (let y = 4; y <= 10; y++) {
        for (let x = 11; x <= 18; x++) {
          const d = Math.hypot(x - 16, y - 7);
          if (d <= 4.0 && d >= 1.5) s.setPixel(x, y, bladeMat, 4.3, -0.5, -0.4, 0.75, 1);
        }
      }
    }
  }
  // 2. Potions (Meniscus line, rising bubbles, cork, glass highlight)
  else if (tval === 75 || tval === 2 || ch === "!") {
    const cx = size >> 1, cy = Math.floor(size * 0.6);
    const rx = (seed & 1) ? 5.2 : 4.4, ry = 5.4;
    // Cork + bottle neck
    for (let y = 4; y <= 7; y++) {
      for (let x = cx - 2; x <= cx + 2; x++) {
        s.setPixel(x, y, y < 6 ? 3 : 6, 3.8, (x - cx) * 0.4, -0.2, 0.9, 0);
      }
    }
    for (let y = 8; y <= size - 4; y++) {
      for (let x = 4; x < size - 4; x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const d2 = dx * dx + dy * dy;
        if (d2 <= 1.0) {
          const nz = Math.sqrt(Math.max(0.15, 1 - d2));
          const isLiquid = y >= cy - 1;
          const isMeniscus = y === cy - 1;
          const isHighlight = x === cx - 3 && y >= cy - 2 && y <= cy + 2;
          const isBubble = (x === cx + 1 && y === cy + 2) || (x === cx - 1 && y === cy + 1);
          s.setPixel(
            x, y,
            isLiquid ? mat : 12,
            3.6 + nz,
            dx * 0.75, dy * 0.5, nz,
            (isHighlight || isBubble) ? 3 : isMeniscus ? 2 : 0
          );
        }
      }
    }
  }
  // 3. Chests (3-plane volumetric box + iron straps height=4.4 + gold lock height=5.2)
  else if (tval === 7 || ch === "~") {
    for (let y = 6; y <= 18; y++) {
      for (let x = 4; x <= 19; x++) {
        const isStrap = x === 7 || x === 16 || y === 11;
        const isLid = y < 11;
        const isLock = x >= 11 && x <= 12 && y >= 11 && y <= 13;
        if (isLock) {
          s.setPixel(x, y, 7, 5.2, -0.3, -0.4, 0.85, 2);
        } else if (isStrap) {
          s.setPixel(x, y, 5, 4.4, -0.2, -0.3, 0.9, 1);
        } else {
          s.setPixel(x, y, 3, 3.4, 0, isLid ? -0.6 : 0.2, 0.8, isLid ? 0 : -1);
        }
      }
    }
  }
  // 4. Scrolls & Spellbooks
  else if (tval === 70 || tval === 69 || (tval >= 90 && tval <= 109) || ch === "?") {
    const isBook = tval >= 90 && tval <= 109;
    const bookMat = isBook ? mat : 10;
    for (let y = 5; y <= 18; y++) {
      for (let x = 6; x <= 17; x++) {
        const isPages = isBook && x >= 15;
        s.setPixel(x, y, isPages ? 10 : bookMat, 3.5, (x - 11.5) * 0.15, -0.2, 0.9, isPages ? 1 : 0);
      }
    }
    // Wax seal or gold clasp
    s.setPixel(11, 11, isBook ? 7 : 11, 4.8, -0.4, -0.4, 0.8, 2);
    s.setPixel(12, 11, isBook ? 7 : 11, 4.8, 0.2, -0.3, 0.9, 1);
    s.setPixel(11, 12, isBook ? 7 : 11, 4.8, -0.2, 0.3, 0.9, 1);
  }
  // 5. Rings & Amulets
  else if (tval === 45 || tval === 40 || ch === "=" || ch === '"') {
    const cx = size >> 1, cy = (size >> 1) + 1;
    for (let y = 5; y <= 19; y++) {
      for (let x = 5; x <= 19; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d >= 2.8 && d <= 5.2) {
          s.setPixel(x, y, 7, 3.8, (x - cx) * 0.2, (y - cy) * 0.2, 0.8, 0);
        }
      }
    }
    // Spherical gem setting
    for (let y = 5; y <= 9; y++) {
      for (let x = cx - 2; x <= cx + 2; x++) {
        if (Math.hypot(x - cx, y - 7) <= 2.3) {
          s.setPixel(x, y, mat, 5.0, (x - cx) * 0.4, (y - 7) * 0.4, 0.8, 2);
        }
      }
    }
  }
  // 6. Gold ($)
  else if (tval === 127 || ch === "$") {
    const coins = [[9, 14], [15, 14], [12, 11]];
    for (const [cx, cy] of coins) {
      for (let y = cy - 3; y <= cy + 3; y++) {
        for (let x = cx - 3; x <= cx + 3; x++) {
          const dx = (x - cx) / 3.2, dy = (y - cy) / 3.0;
          if (dx * dx + dy * dy <= 1.0) {
            s.setPixel(x, y, 7, 4.0 + (12 - cy) * 0.2, dx * 0.7, dy * 0.7, 0.7, 1);
          }
        }
      }
    }
  }
  // 7. Armor / Shields / Helms / Misc
  else {
    const armMat = (tval >= 30 && tval <= 38) ? 6 : mat;
    for (let y = 5; y <= 18; y++) {
      for (let x = 6; x <= 17; x++) {
        if (y > 14 && (x < 8 || x > 15)) continue;
        const u = (x - 11.5) / 5.5;
        const nz = Math.sqrt(Math.max(0.2, 1 - u * u * 0.6));
        const trim = (y === 6 || x === 11) ? 7 : armMat;
        s.setPixel(x, y, trim, trim === 7 ? 4.4 : 3.6, u * 0.75, -0.15, nz, 0);
      }
    }
  }

  s.applyBevelAndAO();
  return surfaceToCanvas(s, { outline: true, ditherStrength: 0.0 });
}

// ============================================================================
// 5. NON-DESTRUCTIVE 16x16 LEGACY REMASTERER (FOR 16px FIX MODE)
// ============================================================================

export function remaster16xSprite(srcCtx, tileX, tileY, tileW = 16, tileH = 16) {
  const srcData = srcCtx.getImageData(tileX, tileY, tileW, tileH).data;
  const outCanvas = document.createElement("canvas");
  outCanvas.width = tileW;
  outCanvas.height = tileH;
  const outCtx = outCanvas.getContext("2d");
  const outImg = outCtx.createImageData(tileW, tileH);
  const out = new Uint32Array(outImg.data.buffer);

  const isBg = new Uint8Array(tileW * tileH);
  const queue = [];
  const checkBg = (i) => {
    const a = srcData[i * 4 + 3];
    const r = srcData[i * 4], g = srcData[i * 4 + 1], b = srcData[i * 4 + 2];
    return a < 40 || (r < 6 && g < 6 && b < 6);
  };

  for (let x = 0; x < tileW; x++) {
    const top = x, bot = (tileH - 1) * tileW + x;
    if (checkBg(top)) { isBg[top] = 1; queue.push(top); }
    if (checkBg(bot) && !isBg[bot]) { isBg[bot] = 1; queue.push(bot); }
  }
  for (let y = 0; y < tileH; y++) {
    const lt = y * tileW, rt = y * tileW + (tileW - 1);
    if (checkBg(lt) && !isBg[lt]) { isBg[lt] = 1; queue.push(lt); }
    if (checkBg(rt) && !isBg[rt]) { isBg[rt] = 1; queue.push(rt); }
  }

  while (queue.length) {
    const idx = queue.pop();
    const x = idx % tileW, y = (idx / tileW) | 0;
    if (x > 0         && !isBg[idx - 1]     && checkBg(idx - 1))     { isBg[idx - 1] = 1;     queue.push(idx - 1); }
    if (x < tileW - 1 && !isBg[idx + 1]     && checkBg(idx + 1))     { isBg[idx + 1] = 1;     queue.push(idx + 1); }
    if (y > 0         && !isBg[idx - tileW] && checkBg(idx - tileW)) { isBg[idx - tileW] = 1; queue.push(idx - tileW); }
    if (y < tileH - 1 && !isBg[idx + tileW] && checkBg(idx + tileW)) { isBg[idx + tileW] = 1; queue.push(idx + tileW); }
  }

  let minX = tileW, maxX = 0, minY = tileH, maxY = 0;
  for (let y = 0; y < tileH; y++) {
    for (let x = 0; x < tileW; x++) {
      if (!isBg[y * tileW + x]) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  const spanW = Math.max(1, maxX - minX);
  const spanH = Math.max(1, maxY - minY);

  for (let y = 0; y < tileH; y++) {
    for (let x = 0; x < tileW; x++) {
      const i = y * tileW + x;
      if (isBg[i]) continue;

      let r = srcData[i * 4], g = srcData[i * 4 + 1], b = srcData[i * 4 + 2];
      const relX = ((x - minX) / spanW) * 2 - 1;
      const relY = ((y - minY) / spanH) * 2 - 1;
      const lightBias = -(relX * 0.55 + relY * 0.45);

      if (lightBias > 0) {
        r = Math.min(255, r + lightBias * 28);
        g = Math.min(255, g + lightBias * 24);
        b = Math.min(255, b + lightBias * 14);
      } else {
        const shade = 1 + lightBias * 0.28;
        r = Math.max(20, r * shade);
        g = Math.max(16, g * shade * 0.95);
        b = Math.max(28, b * (shade * 1.05));
      }

      r = Math.round(r / 16) * 16;
      g = Math.round(g / 16) * 16;
      b = Math.round(b / 16) * 16;

      out[i] = 0xFF000000 | (Math.min(255, b) << 16) | (Math.min(255, g) << 8) | Math.min(255, r);
    }
  }

  for (let y = 1; y < tileH - 1; y++) {
    for (let x = 1; x < tileW - 1; x++) {
      const i = y * tileW + x;
      if (!isBg[i]) continue;
      const nDn = !isBg[i + tileW], nRt = !isBg[i + 1], nUp = !isBg[i - tileW], nLt = !isBg[i - 1];
      if (nDn || nRt || nUp || nLt) {
        const isLitOutline = (nDn || nRt) && !nUp && !nLt;
        out[i] = isLitOutline ? 0xFF382E42 : 0xFF191014;
      }
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  return outCanvas;
}

// ============================================================================
// 6. ATLAS MANAGER & CACHE
// ============================================================================

export class FrogRemasterAtlas {
  constructor(legacySpritesheetImg = null, tileSize = 24) {
    this.legacyCanvas = document.createElement("canvas");
    this.legacyCtx = this.legacyCanvas.getContext("2d", { willReadFrequently: true });
    this.legacyReady = false;
    this.tileSize = tileSize;
    this.cache = new Map();

    if (legacySpritesheetImg) {
      this.attachLegacyImage(legacySpritesheetImg);
    }
  }

  attachLegacyImage(img) {
    if (!img || !img.complete || img.naturalWidth === 0) return;
    this.legacyCanvas.width = img.naturalWidth;
    this.legacyCanvas.height = img.naturalHeight;
    this.legacyCtx.imageSmoothingEnabled = false;
    this.legacyCtx.drawImage(img, 0, 0);
    this.legacyReady = true;
  }

  getOrBuildTile(key, buildFn) {
    let sprite = this.cache.get(key);
    if (!sprite) {
      sprite = buildFn();
      this.cache.set(key, sprite);
    }
    return sprite;
  }

  getRemastered16x(row, col) {
    if (!this.legacyReady) return null;
    const sx = col * 16;
    const sy = row * 16;
    if (sx + 16 > this.legacyCanvas.width || sy + 16 > this.legacyCanvas.height) return null;
    return this.getOrBuildTile(`rem16:${row}:${col}`, () => remaster16xSprite(this.legacyCtx, sx, sy, 16, 16));
  }

  getTerrainTile(featureType, seed = 1, hasSouthFloor = true) {
    const key = `terr:${featureType}:${seed}:${hasSouthFloor ? 1 : 0}`;
    return this.getOrBuildTile(key, () => generateCleanTerrainTile(featureType, this.tileSize, this.tileSize, seed, hasSouthFloor));
  }

  getCreatureSprite(category, charCode, dAttr = 1, entityId = 0) {
    const key = `proc_cre:${category}:${charCode}:${dAttr}:${entityId}`;
    return this.getOrBuildTile(key, () => synthesizeCreatureSprite(category, charCode, dAttr, entityId, this.tileSize));
  }

  getItemSprite(tval, charCode, dAttr = 1, entityId = 0) {
    const key = `proc_itm:${tval}:${charCode}:${dAttr}:${entityId}`;
    return this.getOrBuildTile(key, () => synthesizeItemSprite(tval, charCode, dAttr, entityId, this.tileSize));
  }
}
