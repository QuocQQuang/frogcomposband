// FrogRemasterAtlas.js — Self-Contained Non-Destructive Graphical Remaster Module
// 1. Quiet, low-contrast Dungeon Floors (#1E1C29 base, #171520 faint seams)
// 2. Non-destructive 16x16 Flood-Fill Remasterer (remaster16xSprite)
// 3. Complete 14+ Frogcomposband Terrain & Ore Vein Generator (generateCleanTerrainTile)
// 4. Universal Seed-Varied Fallback Synthesizer for unmapped ASCII/entities

// 5-Tone Hue-Shifted Material Ramps: [DeepShadow, Shadow, Base, Light, Highlight]
const MATERIAL_RAMPS = {
  0:  [0x1B1926, 0x2F2D40, 0x4E4D66, 0x767894, 0xA8B0C4], // Stone / Grey
  1:  [0x261F29, 0x4A3E47, 0x7D6E6D, 0xB5A79A, 0xE8DEC8], // White / Bone
  2:  [0x1B1926, 0x2F2D40, 0x4E4D66, 0x767894, 0xA8B0C4], // Slate
  3:  [0x261A0D, 0x593E16, 0x9E7424, 0xDEB841, 0xFFFF99], // Orange / Amber
  4:  [0x1F0B1C, 0x4A1228, 0x871C33, 0xC93640, 0xFF8078], // Red / Crimson
  5:  [0x131F21, 0x1E3830, 0x325E43, 0x568F56, 0x92C474], // Green
  6:  [0x12132E, 0x242966, 0x3B5DC9, 0x54A2FF, 0xB8F2FF], // Blue / Arcane
  7:  [0x21131A, 0x3D2224, 0x633931, 0x8F5843, 0xBA835E], // Umber / Timber
  8:  [0x141621, 0x262B3D, 0x424C66, 0x6C7D9E, 0xA8BEE0], // L_Dark / Forged Iron
  9:  [0x181C2B, 0x2F3852, 0x526185, 0x8699BF, 0xD4E2FC], // L_White / High Steel
  10: [0x1D1128, 0x3C1F54, 0x6B338C, 0xA855C7, 0xEFB0FF], // Violet / Eldritch
  11: [0x2B1719, 0x59311E, 0x9C6027, 0xD99F36, 0xFAE06B], // Yellow / Gold
  12: [0x291521, 0x522938, 0x8A4853, 0xC47672, 0xF2B39B], // L_Red / Flesh
  13: [0x131F21, 0x1E3830, 0x325E43, 0x568F56, 0x92C474], // L_Green
  14: [0x172026, 0x283840, 0x41585E, 0x658385, 0x9AB5B0], // L_Blue / Teal
  15: [0x24151C, 0x422629, 0x6E423B, 0x9C654F, 0xC79473], // L_Umber / Leather
};

function rgbToAbgr(hex) {
  return 0xFF000000 | ((hex & 0xFF) << 16) | (hex & 0xFF00) | ((hex >> 16) & 0xFF);
}

function hashStr32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * NON-DESTRUCTIVE 16x16 SHADER REMASTERER
 * 1. Flood-fills from corners to find true outer transparency (never deletes internal dark joints!).
 * 2. Applies 22% Upper-Left directional light bias over the artist's original pixel shading.
 * 3. Quantizes channels cleanly and wraps exterior in a 1px Selective Outline (Sel-Out).
 */
export function remaster16xSprite(srcCtx, tileX, tileY, tileW = 16, tileH = 16) {
  const srcData = srcCtx.getImageData(tileX, tileY, tileW, tileH).data;
  const outCanvas = document.createElement("canvas");
  outCanvas.width = tileW;
  outCanvas.height = tileH;
  const outCtx = outCanvas.getContext("2d");
  const outImg = outCtx.createImageData(tileW, tileH);
  const out = new Uint32Array(outImg.data.buffer);

  // Step 1: Corner Flood-Fill to identify TRUE outer background
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

  // Step 2: Compute bounding box of the solid sprite for directional light correction
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

  // Step 3: Non-Destructive Color Grading & 22% Top-Left Light Bias
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

  // Step 4: Clean 1px Exterior Selective Outline (Sel-Out)
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

/**
 * QUIET, READABLE DUNGEON TERRAIN & COMPLETE FROGCOMPOSBAND FEATURE GENERATOR
 * Covers all 14+ terrain types: floor, dirt/road, grass, tree, water, lava,
 * wall_granite, wall_magma, wall_quartz, wall_magma_gold, wall_quartz_gold,
 * wall_perm, rubble, door_closed, door_open, stairs_down, stairs_up, trap, shop.
 */
export function generateCleanTerrainTile(featureType, tileW = 24, tileH = 24, seed = 1, hasSouthFloor = true) {
  const c = document.createElement("canvas");
  c.width = tileW; c.height = tileH;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(tileW, tileH);
  const data = new Uint32Array(img.data.buffer);

  const setPx = (x, y, hex) => {
    if (x >= 0 && y >= 0 && x < tileW && y < tileH) {
      data[y * tileW + x] = rgbToAbgr(hex);
    }
  };

  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263 + seed * 1442695041) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  // Quiet Dungeon Floor (#1E1C29 >90% area, #171520 ultra-faint slab seam, #262434 rare tiny pebble)
  const drawQuietFloor = (baseHex = 0x1E1C29, seamHex = 0x171520, hiHex = 0x262434) => {
    for (let y = 0; y < tileH; y++) {
      for (let x = 0; x < tileW; x++) {
        const row = (y / 8) | 0;
        const stag = (row & 1) * 12;
        const isFaintSeam = (y % 8 === 0 && hash(x, row) < 0.38) || ((x + stag) % 12 === 0 && hash(row, y) < 0.38);
        const isTinyPebble = !isFaintSeam && hash(x, y) < 0.02;
        setPx(x, y, isFaintSeam ? seamHex : isTinyPebble ? hiHex : baseHex);
      }
    }
  };

  if (featureType === "floor") {
    drawQuietFloor(0x1E1C29, 0x171520, 0x262434);
  } else if (featureType === "dirt" || featureType === "road") {
    drawQuietFloor(0x28201E, 0x1F1817, 0x332926);
  } else if (featureType === "grass") {
    drawQuietFloor(0x192923, 0x13201B, 0x243B31);
    for (let i = 0; i < 4; i++) {
      const gx = 3 + ((seed * (i + 3) * 7) % (tileW - 6));
      const gy = 4 + ((seed * (i + 5) * 11) % (tileH - 6));
      setPx(gx, gy, 0x395E48);
      setPx(gx, gy - 1, 0x52825D);
    }
  } else if (featureType === "water" || featureType === "deepwater" || featureType === "lava") {
    const isLava = featureType === "lava";
    const isDeep = featureType === "deepwater";
    const bg = isLava ? 0x4A1221 : isDeep ? 0x121E3A : 0x18284A;
    const wave = isLava ? 0xC93636 : isDeep ? 0x244270 : 0x32588F;
    const glint = isLava ? 0xFAE06B : 0x6CA2E0;
    for (let y = 0; y < tileH; y++) {
      for (let x = 0; x < tileW; x++) {
        const wv = Math.sin(x * 0.45 + y * 0.3 + seed);
        setPx(x, y, wv > 0.82 ? glint : wv > 0.35 ? wave : bg);
      }
    }
  } else if (featureType === "tree") {
    drawQuietFloor(0x192923, 0x13201B, 0x243B31);
    const cx = tileW >> 1, cy = tileH >> 1;
    for (let y = cy + 2; y < tileH - 2; y++) {
      for (let x = cx - 2; x <= cx + 2; x++) setPx(x, y, x < cx ? 0x633931 : 0x3D2224);
    }
    for (let y = 2; y <= cy + 4; y++) {
      for (let x = 2; x < tileW - 2; x++) {
        const d = Math.hypot(x - cx, y - (cy - 2));
        if (d < tileW * 0.38) {
          const lit = (x - cx) + (y - (cy - 2)) < -1;
          setPx(x, y, d > tileW * 0.32 ? 0x131F21 : lit ? 0x568F56 : 0x325E43);
        }
      }
    }
  } else if (featureType.startsWith("wall_") || featureType === "rubble") {
    if (featureType === "rubble") {
      drawQuietFloor();
      const rocks = [[8, 14, 4], [15, 15, 4], [11, 10, 5], [7, 10, 3], [16, 11, 3]];
      for (const [rx, ry, rr] of rocks) {
        for (let y = ry - rr; y <= ry + rr; y++) {
          for (let x = rx - rr; x <= rx + rr; x++) {
            const d = Math.hypot(x - rx, y - ry);
            if (d <= rr) {
              const lit = x < rx && y < ry;
              setPx(x, y, d > rr - 1 ? 0x181622 : lit ? 0x767894 : 0x4E4D66);
            }
          }
        }
      }
    } else {
      const isMagma  = featureType.includes("magma");
      const isQuartz = featureType.includes("quartz");
      const hasGold  = featureType.includes("gold");
      const isPerm   = featureType.includes("perm");

      const palette = isPerm   ? [0x141621, 0x262B3D, 0x424C66, 0x8F6657, 0xD99F36]
                    : isMagma  ? [0x160F19, 0x261921, 0x3D2830, 0x593A42, 0xC93640]
                    : isQuartz ? [0x172026, 0x283840, 0x41585E, 0x658385, 0x9AB5B0]
                               : [0x181622, 0x2B293B, 0x46455E, 0x6C6E8A, 0x9CA2BA];

      const capH = hasSouthFloor ? Math.floor(tileH * 0.45) : tileH;

      for (let y = 0; y < tileH; y++) {
        const isCap = y < capH;
        for (let x = 0; x < tileW; x++) {
          if (isPerm && (y === 0 || y === capH - 1 || y === tileH - 1 || x === 0 || x === tileW - 1)) {
            setPx(x, y, (x % 6 === 0) ? palette[4] : palette[3]);
          } else if (y === capH - 1 && hasSouthFloor) {
            setPx(x, y, palette[3]);
          } else if (isCap) {
            const isInnerRim = y === 1 || x === 1 || x === tileW - 2;
            setPx(x, y, isInnerRim ? palette[2] : palette[1]);
          } else {
            const fy = y - capH;
            const courseH = Math.max(5, (tileH - capH) >> 1);
            const row = (fy / courseH) | 0;
            const ly = fy % courseH;
            const lx = (x + (row & 1) * (tileW >> 1)) % (tileW >> 1);

            if (ly === 0 || lx === 0) {
              setPx(x, y, (isMagma && ((x + y + seed) % 4 === 0)) ? palette[4] : palette[0]);
            } else if (ly === 1) {
              setPx(x, y, palette[3]);
            } else if (y >= tileH - 2) {
              setPx(x, y, palette[1]);
            } else {
              setPx(x, y, palette[2]);
            }
          }
        }
      }

      if (isQuartz) {
        const pts = [[7, 15], [8, 14], [8, 13], [15, 16], [16, 15], [16, 14], [11, 6], [12, 5]];
        for (const [qx, qy] of pts) {
          setPx(qx, qy, 0x54A2FF);
          setPx(qx + 1, qy, 0xB8F2FF);
        }
      }
      if (hasGold) {
        const nuggets = [[6, 14], [14, 16], [10, 13], [9, 5], [16, 7]];
        for (const [gx, gy] of nuggets) {
          setPx(gx,     gy,     0xFAE06B);
          setPx(gx + 1, gy,     0xD99F36);
          setPx(gx,     gy + 1, 0x9C6027);
          setPx(gx + 1, gy + 1, 0x59311E);
        }
      }
    }
  } else if (featureType === "stairs_down" || featureType === "stairs_up") {
    drawQuietFloor();
    const isDown = featureType === "stairs_down";
    for (let step = 0; step < 4; step++) {
      const sy = 4 + step * 4;
      const sx0 = 4 + (isDown ? step : (3 - step));
      const sx1 = tileW - 4 - (isDown ? (3 - step) : step);
      for (let x = sx0; x < sx1; x++) {
        setPx(x, sy,     0x9CA2BA);
        setPx(x, sy + 1, 0x6C6E8A);
        setPx(x, sy + 2, 0x2B293B);
        setPx(x, sy + 3, 0x141019);
      }
    }
  } else if (featureType === "door_closed" || featureType === "door_open") {
    drawQuietFloor();
    const isOpen = featureType === "door_open";
    for (let y = 2; y < tileH - 1; y++) {
      for (let x = 3; x < tileW - 3; x++) {
        const isFrame = x <= 5 || x >= tileW - 6 || y <= 4;
        if (isFrame) {
          setPx(x, y, (y === 2 || x === 3) ? 0x767894 : 0x4E4D66);
        } else if (!isOpen) {
          const isBand = y === 9 || y === 17;
          const isSeam = x % 4 === 0;
          setPx(x, y, isBand ? 0x6C7D9E : isSeam ? 0x3D2224 : 0x633931);
        }
      }
    }
    if (!isOpen) setPx(tileW - 8, 13, 0xFAE06B);
  } else if (featureType === "trap") {
    drawQuietFloor();
    const cx = tileW >> 1, cy = tileH >> 1;
    for (let y = cy - 5; y <= cy + 5; y++) {
      for (let x = cx - 5; x <= cx + 5; x++) {
        const d = Math.abs(x - cx) + Math.abs(y - cy);
        if (d === 5) setPx(x, y, 0xC93640);
        else if (d < 5 && ((x + y) & 1)) setPx(x, y, 0x4A1228);
      }
    }
  } else if (featureType === "shop") {
    drawQuietFloor();
    for (let y = 3; y < tileH - 2; y++) {
      for (let x = 3; x < tileW - 3; x++) {
        if (y < 9) {
          setPx(x, y, ((x >> 1) & 1) ? 0x871C33 : 0xD99F36); // Striped awning
        } else if (x >= 9 && x <= 14 && y >= 12) {
          setPx(x, y, 0x160F19); // Doorway
        } else {
          setPx(x, y, y === 9 ? 0xBA835E : 0x633931);
        }
      }
    }
    setPx(12, 10, 0xFAE06B);
  }

  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * UNIVERSAL SEED-VARIED FALLBACK SYNTHESIZER
 * Used ONLY when an entity lacks a valid bitmap in 16x16.png.
 * Driven deterministically by (category, char, attr, entityId).
 */
export function generateFallbackEntitySprite(category, charCode, dAttr = 1, entityId = 0, w = 16, h = 16) {
  const ch = typeof charCode === "number" ? String.fromCharCode(charCode) : (charCode || "?");
  const seed = hashStr32(`${category}:${ch}:${dAttr}:${entityId}`);
  const ramp = MATERIAL_RAMPS[dAttr & 0x0f] || MATERIAL_RAMPS[1];

  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  const buf = new Uint32Array(img.data.buffer);
  const mask = new Uint8Array(w * h);

  const put = (x, y, tone, customRamp = ramp) => {
    x = x | 0; y = y | 0;
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return;
    const t = Math.max(0, Math.min(4, tone));
    buf[y * w + x] = rgbToAbgr(customRamp[t]);
    mask[y * w + x] = 1;
  };

  const hornStyle = seed % 3;
  const weapStyle = (seed >>> 2) % 3;
  const bodyVar   = (seed >>> 4) % 3;

  if (category === "item") {
    // Potions (!)
    if (ch === "!") {
      put(7, 2, 2, MATERIAL_RAMPS[7]); put(8, 2, 1, MATERIAL_RAMPS[7]);
      put(7, 3, 3, MATERIAL_RAMPS[0]); put(8, 3, 2, MATERIAL_RAMPS[0]);
      const rad = bodyVar === 0 ? 4 : 3;
      for (let y = 5; y <= 13; y++) {
        for (let x = 4; x <= 11; x++) {
          const d = Math.hypot(x - 7.5, y - 9.2);
          if (d <= rad + (y > 8 ? 0.6 : 0)) {
            const lit = x < 7 && y < 9;
            put(x, y, lit ? 4 : d > rad - 0.5 ? 1 : 2);
          }
        }
      }
    }
    // Scrolls / Books (?)
    else if (ch === "?") {
      for (let y = 3; y <= 12; y++) {
        for (let x = 4; x <= 11; x++) {
          const isEdge = x === 4 || x === 11 || y === 3 || y === 12;
          put(x, y, isEdge ? 1 : x < 7 ? 3 : 2, bodyVar === 1 ? MATERIAL_RAMPS[1] : ramp);
        }
      }
      put(7, 7, 4, MATERIAL_RAMPS[4]);
      put(8, 8, 3, MATERIAL_RAMPS[4]);
    }
    // Weapons (|, /, \)
    else if (ch === "|" || ch === "/" || ch === "\\") {
      for (let t = 0; t < 10; t++) {
        const px = 3 + t, py = 12 - t;
        put(px, py, t > 2 ? 4 : 1, t > 2 ? ramp : MATERIAL_RAMPS[7]);
        if (weapStyle === 1 && t > 6) put(px - 1, py, 3); // Axe head
      }
      put(5, 9, 3, MATERIAL_RAMPS[11]);
      put(7, 11, 2, MATERIAL_RAMPS[11]);
    }
    // Rings / Amulets (=, ")
    else if (ch === "=" || ch === '"') {
      for (let y = 4; y <= 11; y++) {
        for (let x = 4; x <= 11; x++) {
          const d = Math.hypot(x - 7.5, y - 8);
          if (d >= 2.2 && d <= 4.0) put(x, y, x < 7 ? 4 : 2, MATERIAL_RAMPS[11]);
        }
      }
      put(7, 4, 4); put(8, 4, 3);
    }
    // Gold ($)
    else if (ch === "$") {
      for (let k = 0; k < 3; k++) {
        const cx = 5 + k * 2, cy = 10 - (k & 1) * 2;
        for (let dx = -2; dx <= 2; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            put(cx + dx, cy + dy, dx < 0 && dy <= 0 ? 4 : 2, MATERIAL_RAMPS[11]);
          }
        }
      }
    }
    // Generic Armor / Staff / Misc
    else {
      for (let y = 4; y <= 11; y++) {
        for (let x = 4; x <= 11; x++) {
          if ((x === 4 || x === 11) && y > 9) continue;
          put(x, y, x < 7 && y < 8 ? 3 : 2);
        }
      }
    }
  } else {
    // Player (@) or Monster (a-z, A-Z)
    const isPlayer = ch === "@";
    const isQuad = "CfZqrSa".includes(ch);
    const isDragon = ch === "D" || ch === "d" || ch === "M";
    const isJelly = "jm,e".includes(ch);

    if (isJelly) {
      for (let y = 5; y <= 13; y++) {
        for (let x = 3; x <= 12; x++) {
          const d = Math.hypot((x - 7.5) / 4.5, (y - 9.5) / 3.8);
          if (d <= 1.0) put(x, y, x < 7 && y < 9 ? 4 : d > 0.78 ? 1 : 2);
        }
      }
      put(7, 9, 0); put(8, 9, 4, MATERIAL_RAMPS[4]);
    } else if (isQuad) {
      // Horizontal crouched beast
      for (let y = 7; y <= 11; y++) {
        for (let x = 4; x <= 12; x++) put(x, y, y < 9 ? 3 : 2);
      }
      for (let y = 5; y <= 8; y++) for (let x = 2; x <= 5; x++) put(x, y, 3); // Head
      put(3, 6, 4, MATERIAL_RAMPS[4]); // Eye
      for (let y = 11; y <= 13; y++) { put(5, y, 1); put(11, y, 1); } // Legs
      put(13, 7 - bodyVar, 2); // Tail
    } else if (isDragon) {
      // Wings + S-neck + horned snout + tail
      for (let y = 2; y <= 7; y++) {
        put(2, y, 1); put(3, y + 1, 2); put(13, y, 1); put(12, y + 1, 2);
      }
      for (let y = 5; y <= 12; y++) for (let x = 5; x <= 10; x++) put(x, y, x < 7 ? 3 : 2);
      for (let y = 2; y <= 5; y++) for (let x = 6; x <= 9; x++) put(x, y, 3); // Head
      put(5, 2, 4, MATERIAL_RAMPS[1]); put(10, 2, 4, MATERIAL_RAMPS[1]); // Horns
      put(7, 3, 4, MATERIAL_RAMPS[3]); // Eye
      put(6, 13, 1); put(9, 13, 1);
    } else {
      // Humanoid / Hero / Undead / Demon with seed-varied helm, armor & weapon
      const headMat = isPlayer ? MATERIAL_RAMPS[9] : ramp;
      for (let y = 2; y <= 5; y++) for (let x = 6; x <= 9; x++) put(x, y, y === 2 ? 4 : 3, headMat);
      if (hornStyle === 1 || ch === "o" || ch === "u" || ch === "U") {
        put(5, 2, 4, MATERIAL_RAMPS[1]); put(10, 2, 4, MATERIAL_RAMPS[1]);
      } else if (hornStyle === 2 || isPlayer) {
        put(7, 1, 4, MATERIAL_RAMPS[11]); put(8, 1, 4, MATERIAL_RAMPS[11]);
      }
      // Eyes
      put(6, 4, 4, isPlayer ? MATERIAL_RAMPS[6] : MATERIAL_RAMPS[4]);
      put(9, 4, 4, isPlayer ? MATERIAL_RAMPS[6] : MATERIAL_RAMPS[4]);
      // Torso
      for (let y = 6; y <= 10; y++) {
        for (let x = 5; x <= 10; x++) put(x, y, x < 7 ? 3 : 2);
      }
      // Legs
      for (let y = 11; y <= 13; y++) { put(6, y, 1); put(9, y, 1); }
      // Weapon
      if (weapStyle === 0 || isPlayer) {
        for (let y = 3; y <= 9; y++) put(12, y, y < 7 ? 4 : 2, MATERIAL_RAMPS[9]);
      } else if (weapStyle === 1) {
        for (let y = 2; y <= 12; y++) put(12, y, 2, MATERIAL_RAMPS[7]);
        put(12, 2, 4, MATERIAL_RAMPS[6]);
      } else {
        for (let y = 6; y <= 10; y++) put(3, y, 3, MATERIAL_RAMPS[9]); // Shield
      }
    }
  }

  // 1px Exterior Sel-Out (#382E42 lit top-left, #141019 dark bottom-right)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mask[i]) continue;
      const nDn = mask[i + w], nRt = mask[i + 1], nUp = mask[i - w], nLt = mask[i - 1];
      if (nDn || nRt || nUp || nLt) {
        const isLit = (nDn || nRt) && !nUp && !nLt;
        buf[i] = isLit ? 0xFF382E42 : 0xFF191014;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * DROP-IN ATLAS INTERCEPTOR & CACHE
 */
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

  getFallbackEntity(category, charCode, dAttr = 1, entityId = 0) {
    const key = `fb:${category}:${charCode}:${dAttr}:${entityId}`;
    return this.getOrBuildTile(key, () => generateFallbackEntitySprite(category, charCode, dAttr, entityId, 16, 16));
  }
}
