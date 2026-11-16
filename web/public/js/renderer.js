// 60 FPS 5-Layer Compositor Canvas Renderer (Strict Pixel Overhaul)
// Layers:
//   1. Seamless Toroidal Voronoi Cobblestone & Biome Base
//   2. All 7 Frogcomposband Wall/Ore Vein/Rubble Types + Doors/Stairs/Trees + Wall Drop Shadows
//   3. 2x2 Bayer-Dithered Contact Shadows (#141019)
//   4. Y-Sorted Items & 1.25x Tall Actors (Hand-crafted Pixel Templates + Non-Destructive 16x16 Remaster)
//   5. 4x4 Bayer Ordered Dither Torchlight, Emissive Glows & Combat Particles

import { SHADOW_BASE_HEX, BAYER_4X4, StrictAtlasManager } from "./strict-pixel-atlas.js";

const ZOOM_STEPS = [0.5, 1.0, 1.5, 2.0, 3.0];

function classifyWallType(cellCh, ta, tc) {
  if (cellCh === "R") return "rubble";
  if (cellCh === "M") return "magma";
  if (cellCh === "Q") return "quartz";
  if (cellCh === "m") return "magma_gold";
  if (cellCh === "q") return "quartz_gold";
  if (cellCh === "P") return "permanent";
  if (cellCh === "W") return "granite";

  // Fallback by 16x16.png graf-new.prf tile coordinate
  if ((ta & 0x80) && (tc & 0x80)) {
    const row = ta & 0x7f;
    const col = tc & 0x7f;
    if (row === 0) {
      if (col >= 4 && col <= 6) return "granite";
      if (col >= 7 && col <= 9) return "quartz";
      if (col >= 10 && col <= 12) return "quartz_gold";
      if (col >= 13 && col <= 15) return "magma";
      if (col >= 16 && col <= 18) return "magma_gold";
      if (col >= 19 && col <= 21) return "permanent";
      if (col >= 28 && col <= 30) return "rubble";
    }
  }
  return null;
}

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.ctx.imageSmoothingEnabled = false;

    this.cols = 108;
    this.rows = 36;
    this.colors = [];
    this.initDefaultPalette();

    this.grid = new Uint8Array(this.cols * this.rows * 4);
    this.cursor = { x: 0, y: 0, v: false };
    this.state = { gen: false, dungeon: false, icky: true, ctx: 0, graf: "overhaul" };

    this.atlas = new StrictAtlasManager();

    this.sheets = {
      proc32: { img: new Image(), tileSize: 32, loaded: false },
      new: { img: new Image(), tileSize: 16, loaded: false },
      old: { img: new Image(), tileSize: 8, loaded: false },
    };
    this.sheets.proc32.img.onload = () => { this.sheets.proc32.loaded = true; };
    this.sheets.new.img.onload = () => {
      this.sheets.new.loaded = true;
      this.atlas.attachLegacy16Image(this.sheets.new.img);
    };
    this.sheets.old.img.onload = () => { this.sheets.old.loaded = true; };
    this.sheets.proc32.img.src = "/tiles/32x32.png";
    this.sheets.new.img.src = "/tiles/16x16.png";
    this.sheets.old.img.src = "/tiles/8x8.png";

    this.lightCanvas = document.createElement("canvas");
    this.lightCtx = this.lightCanvas.getContext("2d");

    this.zoom = 2.0;
    this.fxEnabled = true;
    this.hoverCell = null;
    this.particles = [];
    this.shakeTime = 0;
    this.shakeAmp = 0;

    this.layout = {
      mode: "term",
      offsetX: 0,
      offsetY: 0,
      cellW: 24,
      cellH: 24,
      mapX: 0,
      mapY: 1,
      mapW: 95,
      mapH: 29,
      camX: 0,
      camY: 0,
    };

    this._lastHp = -1;
    this._lastLev = -1;
  }

  initDefaultPalette() {
    const base = [
      [20, 16, 25], [238, 242, 248], [148, 163, 184], [249, 115, 22],
      [229, 83, 75], [63, 185, 80], [76, 154, 255], [194, 134, 72],
      [75, 85, 99], [203, 213, 225], [192, 132, 252], [250, 204, 21],
      [251, 113, 133], [110, 231, 183], [79, 209, 197], [243, 208, 163],
    ];
    this.colors = Array.from({ length: 256 }, (_, i) => base[i % 16]);
  }

  stepZoom(dir) {
    let idx = ZOOM_STEPS.findIndex((z) => Math.abs(z - this.zoom) < 0.05);
    if (idx === -1) idx = 3;
    const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + (dir > 0 ? 1 : -1)));
    this.zoom = ZOOM_STEPS[next];
    return this.zoom;
  }

  setInit(msg) {
    if (Array.isArray(msg.colors) && msg.colors.length >= 16) this.colors = msg.colors;
    this.resizeGrid(msg.cols || 108, msg.rows || 36);
  }

  resizeGrid(cols, rows) {
    if (cols === this.cols && rows === this.rows && this.grid.length === cols * rows * 4) return;
    this.cols = cols;
    this.rows = rows;
    this.grid = new Uint8Array(cols * rows * 4);
  }

  applyFrame(msg) {
    if (msg.w && msg.h) this.resizeGrid(msg.w, msg.h);
    this.cursor.x = msg.cx ?? 0;
    this.cursor.y = msg.cy ?? 0;
    this.cursor.v = !!msg.cv;

    if (Array.isArray(msg.dirty)) {
      for (const rowArr of msg.dirty) {
        const y = rowArr[0];
        if (y < 0 || y >= this.rows) continue;
        const base = y * this.cols * 4;
        const limit = Math.min(this.cols * 4, rowArr.length - 1);
        for (let i = 0; i < limit; i++) {
          this.grid[base + i] = rowArr[i + 1];
        }
      }
    }

    if (msg.state) {
      this.detectVisualCues(msg.state, msg.sounds || []);
      this.state = msg.state;
    }
  }

  detectVisualCues(nextState, sounds) {
    const p = nextState.player;
    if (!p || !nextState.dungeon || nextState.icky) return;

    if (this._lastHp >= 0 && p.chp < this._lastHp && this.fxEnabled) {
      const dmg = this._lastHp - p.chp;
      this.spawnBurst(p.px, p.py, "#ff8078", 10, `-${dmg}`);
      this.shakeTime = 0.14;
      this.shakeAmp = Math.min(5, 2 + Math.ceil((dmg / Math.max(1, p.mhp)) * 12));
    } else if (this._lastHp >= 0 && p.chp > this._lastHp + 2 && this.fxEnabled) {
      this.spawnBurst(p.px, p.py, "#92c474", 8, `+${p.chp - this._lastHp}`);
    }

    if (this._lastLev > 0 && p.lev > this._lastLev && this.fxEnabled) {
      this.spawnBurst(p.px, p.py, "#fae06b", 20, "LEVEL UP!");
    }

    for (const s of sounds) {
      if ((s === 1 || s === 5 || s === 31) && p.target && this.fxEnabled) {
        this.spawnBurst(p.target.x, p.target.y, s === 31 ? "#fae06b" : "#c93640", 8);
      } else if ((s === 12 || s === 40) && p.target && this.fxEnabled) {
        this.spawnBurst(p.target.x, p.target.y, "#54a2ff", 10);
      }
    }

    this._lastHp = p.chp;
    this._lastLev = p.lev;
  }

  spawnBurst(caveX, caveY, color, count = 10, text = null) {
    const vp = this.state.vp;
    const mr = this.state.mapRect;
    if (!vp || !mr) return;
    const uiX = mr.x + (caveX - vp.x);
    const uiY = mr.y + (caveY - vp.y);
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const spd = 25 + Math.random() * 55;
      this.particles.push({
        uiX: uiX + 0.5,
        uiY: uiY + 0.5,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0.45 + Math.random() * 0.2,
        maxLife: 0.65,
        color,
        size: 2,
      });
    }
    if (text) {
      this.particles.push({
        uiX: uiX + 0.5,
        uiY: uiY + 0.1,
        vx: 0,
        vy: -28,
        life: 0.85,
        maxLife: 0.85,
        color,
        text,
      });
    }
  }

  colorCss(attr) {
    const c = this.colors[attr & 0xff] || this.colors[1];
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  isMapMode() {
    return !!(this.state && this.state.dungeon && !this.state.icky && this.state.ctx === 0 && this.state.mapRect);
  }

  pixelToCell(px, py) {
    const L = this.layout;
    if (L.mode === "map") {
      const mx = Math.floor((px - L.camX) / L.cellW);
      const my = Math.floor((py - L.camY) / L.cellH);
      const ux = L.mapX + mx;
      const uy = L.mapY + my;
      if (ux >= L.mapX && ux < L.mapX + L.mapW && uy >= L.mapY && uy < L.mapY + L.mapH) {
        return { x: ux, y: uy, inMap: true };
      }
      return null;
    }
    const cx = Math.floor((px - L.offsetX) / L.cellW);
    const cy = Math.floor((py - L.offsetY) / L.cellH);
    if (cx < 0 || cx >= this.cols || cy < 0 || cy >= this.rows) return null;
    return { x: cx, y: cy, inMap: false };
  }

  render(nowMs, dtSec) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const targetW = Math.max(1, Math.floor(rect.width * dpr));
    const targetH = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }

    const ctx = this.ctx;
    const W = rect.width;
    const H = rect.height;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = "#141019";
    ctx.fillRect(0, 0, W, H);

    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dtSec);
      ctx.translate(
        Math.round((Math.random() - 0.5) * 2 * this.shakeAmp),
        Math.round((Math.random() - 0.5) * 2 * this.shakeAmp)
      );
    }

    if (this.isMapMode()) {
      this.renderMap5Layer(ctx, W, H, nowMs, dtSec);
    } else {
      this.renderTermMode(ctx, W, H, nowMs);
    }

    ctx.restore();
  }

  // ==========================================================================
  // 5-LAYER COMPOSITOR DRAW PASS
  // ==========================================================================

  renderMap5Layer(ctx, W, H, nowMs, dtSec) {
    const mr = this.state.mapRect;
    const topBarH = 28;
    const botBarH = 26;
    const availH = Math.max(120, H - topBarH - botBarH);

    const graf = this.state.graf || "overhaul";
    const baseLogical = graf === "proc32" ? 32 : 24;
    const tileDraw = Math.max(12, Math.round(baseLogical * this.zoom));
    const tallDrawH = Math.round((tileDraw * 30) / 24);
    const tallExtra = tallDrawH - tileDraw;

    const totalMapW = mr.w * tileDraw;
    const totalMapH = mr.h * tileDraw;

    let camX = Math.floor((W - totalMapW) / 2);
    let camY = Math.floor(topBarH + (availH - totalMapH) / 2);

    const p = this.state.player;
    const vp = this.state.vp;
    if (p && vp && (totalMapW > W || totalMapH > availH)) {
      const pLocalX = (p.px - vp.x + 0.5) * tileDraw;
      const pLocalY = (p.py - vp.y + 0.5) * tileDraw;
      if (totalMapW > W) camX = Math.round(Math.min(0, Math.max(W - totalMapW, W / 2 - pLocalX)));
      if (totalMapH > availH) camY = Math.round(Math.min(topBarH, Math.max(topBarH + availH - totalMapH, topBarH + availH / 2 - pLocalY)));
    }

    this.layout = {
      mode: "map",
      offsetX: camX,
      offsetY: camY,
      cellW: tileDraw,
      cellH: tileDraw,
      mapX: mr.x,
      mapY: mr.y,
      mapW: mr.w,
      mapH: mr.h,
      camX,
      camY,
    };

    const cells = this.state.cells || "";
    const los = this.state.los || "";
    const animFrame = Math.floor(nowMs / 600) % 2;

    const cellAt = (mx, my) => {
      if (mx < 0 || mx >= mr.w || my < 0 || my >= mr.h) return "0";
      return cells[my * mr.w + mx] || "G";
    };
    const isSolidWallChar = (ch) => "WMQmqP".includes(ch);

    const minMx = Math.max(0, Math.floor((0 - camX) / tileDraw) - 1);
    const maxMx = Math.min(mr.w - 1, Math.ceil((W - camX) / tileDraw) + 1);
    const minMy = Math.max(0, Math.floor((topBarH - camY) / tileDraw) - 1);
    const maxMy = Math.min(mr.h - 1, Math.ceil((topBarH + availH - camY) / tileDraw) + 1);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, topBarH, W, availH);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;

    const useOverhaul = graf === "overhaul";
    const useRemaster16 = graf === "new";
    const useProc32 = graf === "proc32" && this.sheets.proc32.loaded;
    const useOld8 = graf === "old" && this.sheets.old.loaded;
    const useAscii = graf === "ascii";

    // ---------------- LAYER 1: TOROIDAL VORONOI SEAMLESS FLOOR ----------------
    if (!useAscii) {
      for (let my = minMy; my <= maxMy; my++) {
        const uy = mr.y + my;
        const dy = camY + my * tileDraw;
        for (let mx = minMx; mx <= maxMx; mx++) {
          const ux = mr.x + mx;
          const ch = cellAt(mx, my);
          if (ch === "0") continue;
          const dx = camX + mx * tileDraw;

          if (useProc32 || useOld8) {
            const sheet = useProc32 ? this.sheets.proc32 : this.sheets.old;
            const ts = sheet.tileSize;
            const idx = (uy * this.cols + ux) * 4;
            const ta = this.grid[idx + 2], tc = this.grid[idx + 3];
            if ((ta & 0x80) && (tc & 0x80)) {
              ctx.drawImage(sheet.img, (tc & 0x7f) * ts, (ta & 0x7f) * ts, ts, ts, dx, dy, tileDraw, tileDraw);
              continue;
            }
          }

          let biome = "stone";
          if (ch === "~") biome = "water";
          else if (ch === "w") biome = "deepwater";
          else if (ch === "L") biome = "lava";
          else if (ch === "g" || ch === "T") biome = "grass";
          else if (ch === "P" || ch === "Q" || ch === "q") biome = "crypt";

          const variant = (mx * 7 + my * 13) & 3;
          const frame = (biome === "water" || biome === "deepwater" || biome === "lava") ? animFrame : 0;
          ctx.drawImage(this.atlas.getFloor(biome, variant, frame), dx, dy, tileDraw, tileDraw);
        }
      }
    } else {
      ctx.font = `700 ${Math.max(10, Math.floor(tileDraw * 0.78))}px "Cascadia Code", Consolas, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let my = minMy; my <= maxMy; my++) {
        const uy = mr.y + my, dy = camY + my * tileDraw;
        for (let mx = minMx; mx <= maxMx; mx++) {
          const ux = mr.x + mx, dx = camX + mx * tileDraw;
          const idx = (uy * this.cols + ux) * 4;
          const a = this.grid[idx], c = this.grid[idx + 1];
          const glyph = c >= 32 && c < 127 ? String.fromCharCode(c) : " ";
          if (glyph !== " ") {
            ctx.fillStyle = this.colorCss(a);
            ctx.fillText(glyph, dx + tileDraw * 0.5, dy + tileDraw * 0.52);
          }
        }
      }
    }

    // ---------------- LAYER 2: ALL 7 WALL/ORE VEIN/RUBBLE TYPES & FEATURES ----------------
    if (!useAscii && !useProc32 && !useOld8) {
      const dropH = Math.max(2, Math.round((tileDraw * 4) / 24));
      for (let my = minMy; my <= maxMy; my++) {
        const uy = mr.y + my, dy = camY + my * tileDraw;
        for (let mx = minMx; mx <= maxMx; mx++) {
          const ux = mr.x + mx, dx = camX + mx * tileDraw;
          const ch = cellAt(mx, my);
          if (ch === "0") continue;

          const idx = (uy * this.cols + ux) * 4;
          const ta = this.grid[idx + 2], tc = this.grid[idx + 3];
          const wallType = classifyWallType(ch, ta, tc);

          if (wallType) {
            const southCh = cellAt(mx, my + 1);
            const hasSouthFloor = !isSolidWallChar(southCh) && southCh !== "0";
            const variant = (mx * 11 + my * 5) & 3;
            const wallImg = this.atlas.getWall(wallType, hasSouthFloor, variant);
            ctx.drawImage(wallImg, dx, dy, tileDraw, tileDraw);

            if (wallType !== "rubble" && hasSouthFloor) {
              ctx.drawImage(this.atlas.wallDropShadow, dx, dy + tileDraw, tileDraw, dropH);
            }
          } else if (ch === "D") {
            const doorImg = useRemaster16 && (ta & 0x80) && (tc & 0x80)
              ? this.atlas.getRemastered16(ta & 0x7f, tc & 0x7f, 24, 24)
              : this.atlas.getTemplate("door_closed_16", {}, 24, 24);
            if (doorImg) ctx.drawImage(doorImg, dx, dy, tileDraw, tileDraw);
          } else if (ch === "d") {
            const doorImg = useRemaster16 && (ta & 0x80) && (tc & 0x80)
              ? this.atlas.getRemastered16(ta & 0x7f, tc & 0x7f, 24, 24)
              : this.atlas.getTemplate("door_open_16", {}, 24, 24);
            if (doorImg) ctx.drawImage(doorImg, dx, dy, tileDraw, tileDraw);
          } else if (ch === "<") {
            const stImg = this.atlas.getTemplate("stairs_up_16", {}, 24, 24);
            if (stImg) ctx.drawImage(stImg, dx, dy, tileDraw, tileDraw);
          } else if (ch === ">") {
            const stImg = this.atlas.getTemplate("stairs_down_16", {}, 24, 24);
            if (stImg) ctx.drawImage(stImg, dx, dy, tileDraw, tileDraw);
          } else if ("TS^".includes(ch)) {
            if ((ta & 0x80) && (tc & 0x80)) {
              const rem = this.atlas.getRemastered16(ta & 0x7f, tc & 0x7f, 24, ch === "T" ? 30 : 24);
              if (rem) {
                ctx.drawImage(rem, dx, ch === "T" ? dy - tallExtra : dy, tileDraw, ch === "T" ? tallDrawH : tileDraw);
              }
            }
          }
        }
      }
    } else if (useProc32 || useOld8) {
      const sheet = useProc32 ? this.sheets.proc32 : this.sheets.old;
      const ts = sheet.tileSize;
      for (let my = minMy; my <= maxMy; my++) {
        const uy = mr.y + my, dy = camY + my * tileDraw;
        for (let mx = minMx; mx <= maxMx; mx++) {
          const ux = mr.x + mx, dx = camX + mx * tileDraw;
          const idx = (uy * this.cols + ux) * 4;
          const a = this.grid[idx], c = this.grid[idx + 1], ta = this.grid[idx + 2], tc = this.grid[idx + 3];
          if ((a & 0x80) && (c & 0x80) && (a !== ta || c !== tc)) {
            const isActorHere = p && vp && ux === mr.x + (p.px - vp.x) && uy === mr.y + (p.py - vp.y);
            if (!isActorHere) {
              ctx.drawImage(sheet.img, (c & 0x7f) * ts, (a & 0x7f) * ts, ts, ts, dx, dy, tileDraw, tileDraw);
            }
          }
        }
      }
    }

    // ---------------- LAYER 3: BAYER-DITHERED CONTACT SHADOWS ----------------
    const objs = Array.isArray(this.state.objs) ? this.state.objs : [];
    const mons = Array.isArray(this.state.mons) ? this.state.mons : [];
    const shadowH = Math.max(4, Math.round((tileDraw * 10) / 24));

    if (!useAscii) {
      for (const o of objs) {
        const mx = o[0] - mr.x, my = o[1] - mr.y;
        if (mx < minMx || mx > maxMx || my < minMy || my > maxMy) continue;
        ctx.drawImage(this.atlas.contactShadow, camX + mx * tileDraw, camY + my * tileDraw + Math.round(tileDraw * 0.62), tileDraw, shadowH);
      }
      for (const m of mons) {
        const mx = m[0] - mr.x, my = m[1] - mr.y;
        if (mx < minMx || mx > maxMx || my < minMy || my > maxMy) continue;
        ctx.drawImage(this.atlas.contactShadow, camX + mx * tileDraw, camY + my * tileDraw + Math.round(tileDraw * 0.68), tileDraw, shadowH);
      }
      if (p && vp) {
        const pmx = p.px - vp.x, pmy = p.py - vp.y;
        if (pmx >= minMx && pmx <= maxMx && pmy >= minMy && pmy <= maxMy) {
          ctx.drawImage(this.atlas.contactShadow, camX + pmx * tileDraw, camY + pmy * tileDraw + Math.round(tileDraw * 0.68), tileDraw, shadowH);
        }
      }
    }

    // ---------------- LAYER 4: Y-SORTED ITEMS & 1.25x TALL ACTORS ----------------
    const objsByRow = new Map();
    for (const o of objs) {
      const my = o[1] - mr.y;
      if (my < minMy || my > maxMy) continue;
      if (!objsByRow.has(my)) objsByRow.set(my, []);
      objsByRow.get(my).push(o);
    }

    const monsByRow = new Map();
    for (const m of mons) {
      const my = m[1] - mr.y;
      if (my < minMy - 1 || my > maxMy + 1) continue;
      if (!monsByRow.has(my)) monsByRow.set(my, []);
      monsByRow.get(my).push(m);
    }

    const pmy = p && vp ? p.py - vp.y : -999;
    const pmx = p && vp ? p.px - vp.x : -999;

    for (let my = Math.max(0, minMy - 1); my <= Math.min(mr.h - 1, maxMy + 1); my++) {
      const dy = camY + my * tileDraw;

      const rowObjs = objsByRow.get(my);
      if (rowObjs && !useAscii) {
        for (const o of rowObjs) {
          const [ux, , tval, , , dAttr, xAttr, xChar] = o;
          const mx = ux - mr.x;
          if (mx < minMx || mx > maxMx) continue;
          const dx = camX + mx * tileDraw;

          if (useOverhaul || useRemaster16) {
            const itemImg = this.atlas.getItemSprite(tval, dAttr, xAttr, xChar, useOverhaul);
            if (itemImg) ctx.drawImage(itemImg, dx, dy, tileDraw, tileDraw);
          }
        }
      }

      const rowMons = monsByRow.get(my);
      if (rowMons && !useAscii) {
        for (const m of rowMons) {
          const [ux, , hpPct, att, sleep, uniq, , dChar, , dAttr, xAttr, xChar] = m;
          const mx = ux - mr.x;
          if (mx < minMx || mx > maxMx) continue;
          const dx = camX + mx * tileDraw;

          if (useOverhaul || useRemaster16) {
            const monImg = this.atlas.getMonsterSprite(dChar, dAttr, xAttr, xChar, animFrame, useOverhaul);
            if (monImg) ctx.drawImage(monImg, dx, dy - tallExtra, tileDraw, tallDrawH);
          } else if (useProc32 || useOld8) {
            const sheet = useProc32 ? this.sheets.proc32 : this.sheets.old;
            const ts = sheet.tileSize;
            const idx = (mr.y + my) * this.cols * 4 + ux * 4;
            const a = this.grid[idx], c = this.grid[idx + 1];
            if ((a & 0x80) && (c & 0x80)) {
              ctx.drawImage(sheet.img, (c & 0x7f) * ts, (a & 0x7f) * ts, ts, ts, dx, dy, tileDraw, tileDraw);
            }
          }

          if (att === 2 || att === 1) {
            ctx.strokeStyle = att === 2 ? "rgba(146, 196, 116, 0.88)" : "rgba(84, 162, 255, 0.88)";
            ctx.lineWidth = 2;
            ctx.strokeRect(dx + 1, dy + 1, tileDraw - 2, tileDraw - 2);
          } else if (uniq) {
            ctx.strokeStyle = "rgba(250, 224, 107, 0.85)";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(dx + 1, dy + 1, tileDraw - 2, tileDraw - 2);
          }

          if (hpPct < 100) {
            const bw = Math.max(12, tileDraw - 6);
            const bh = 4;
            const bx = dx + Math.floor((tileDraw - bw) / 2);
            const by = dy + tileDraw - 5;
            ctx.fillStyle = "#141019";
            ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
            ctx.fillStyle = hpPct > 55 ? "#568f56" : hpPct > 25 ? "#deb841" : "#c93640";
            ctx.fillRect(bx, by, Math.round((bw * Math.max(0, hpPct)) / 100), bh);
          }

          if (sleep) {
            ctx.font = `700 ${Math.max(10, Math.floor(tileDraw * 0.34))}px monospace`;
            ctx.fillStyle = "#b8f2ff";
            ctx.fillText("z", dx + tileDraw - 6, dy - tallExtra + 8);
          }
        }
      }

      if (my === pmy && pmx >= minMx && pmx <= maxMx && !useAscii) {
        const dx = camX + pmx * tileDraw;
        if (useOverhaul) {
          const playerImg = this.atlas.getPlayerSprite(p.pclass || 0, animFrame);
          if (playerImg) ctx.drawImage(playerImg, dx, dy - tallExtra, tileDraw, tallDrawH);
        } else if (useRemaster16) {
          const idx = ((mr.y + pmy) * this.cols + (mr.x + pmx)) * 4;
          const a = this.grid[idx], c = this.grid[idx + 1];
          let playerImg = (a & 0x80) && (c & 0x80)
            ? this.atlas.getRemastered16(a & 0x7f, c & 0x7f, 24, 30)
            : null;
          if (!playerImg) playerImg = this.atlas.getPlayerSprite(p.pclass || 0, animFrame);
          ctx.drawImage(playerImg, dx, dy - tallExtra, tileDraw, tallDrawH);
        } else if (useProc32 || useOld8) {
          const sheet = useProc32 ? this.sheets.proc32 : this.sheets.old;
          const ts = sheet.tileSize;
          const idx = ((mr.y + pmy) * this.cols + (mr.x + pmx)) * 4;
          const a = this.grid[idx], c = this.grid[idx + 1];
          if ((a & 0x80) && (c & 0x80)) {
            ctx.drawImage(sheet.img, (c & 0x7f) * ts, (a & 0x7f) * ts, ts, ts, dx, dy, tileDraw, tileDraw);
          }
        }
      }
    }

    // ---------------- LAYER 5: BAYER 4x4 TORCHLIGHT, RETICLES & PARTICLES ----------------
    if (this.fxEnabled && p && vp) {
      this.renderBayerTorchlight(ctx, mr, camX, camY, tileDraw, minMx, maxMx, minMy, maxMy, p, vp, los, cells, nowMs);
    }

    if (p && p.target && vp) {
      const tx = camX + (p.target.x - vp.x) * tileDraw;
      const ty = camY + (p.target.y - vp.y) * tileDraw;
      const pulse = 0.65 + 0.35 * Math.sin(nowMs * 0.008);
      ctx.strokeStyle = `rgba(255, 128, 120, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(tx + 1, ty + 1, tileDraw - 2, tileDraw - 2);
    }

    if (this.hoverCell && this.hoverCell.inMap) {
      const hx = camX + (this.hoverCell.x - mr.x) * tileDraw;
      const hy = camY + (this.hoverCell.y - mr.y) * tileDraw;
      const arm = Math.max(6, Math.floor(tileDraw * 0.28));
      ctx.strokeStyle = "rgba(110, 231, 183, 0.92)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx + 1, hy + arm); ctx.lineTo(hx + 1, hy + 1); ctx.lineTo(hx + arm, hy + 1);
      ctx.moveTo(hx + tileDraw - arm, hy + 1); ctx.lineTo(hx + tileDraw - 1, hy + 1); ctx.lineTo(hx + tileDraw - 1, hy + arm);
      ctx.moveTo(hx + 1, hy + tileDraw - arm); ctx.lineTo(hx + 1, hy + tileDraw - 1); ctx.lineTo(hx + arm, hy + tileDraw - 1);
      ctx.moveTo(hx + tileDraw - arm, hy + tileDraw - 1); ctx.lineTo(hx + tileDraw - 1, hy + tileDraw - 1); ctx.lineTo(hx + tileDraw - 1, hy + tileDraw - arm);
      ctx.stroke();
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dtSec;
      if (pt.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      pt.uiX += (pt.vx * dtSec) / tileDraw;
      pt.uiY += (pt.vy * dtSec) / tileDraw;
      const px = Math.round(camX + (pt.uiX - mr.x) * tileDraw);
      const py = Math.round(camY + (pt.uiY - mr.y) * tileDraw);
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.life / pt.maxLife));
      if (pt.text) {
        ctx.font = `800 13px "Segoe UI", sans-serif`;
        ctx.textAlign = "center";
        ctx.fillStyle = "#141019";
        ctx.fillText(pt.text, px + 1, py + 1);
        ctx.fillStyle = pt.color;
        ctx.fillText(pt.text, px, py);
      } else {
        ctx.fillStyle = pt.color;
        ctx.fillRect(px, py, pt.size, pt.size);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    this.renderBannerRow(ctx, 0, 0, 0, W, topBarH);
    this.renderBannerRow(ctx, this.rows - 1, 0, H - botBarH, W, botBarH);
  }

  renderBayerTorchlight(ctx, mr, camX, camY, tileDraw, minMx, maxMx, minMy, maxMy, p, vp, los, cells, nowMs) {
    const sub = 4;
    const visW = maxMx - minMx + 1;
    const visH = maxMy - minMy + 1;
    const lw = visW * sub;
    const lh = visH * sub;
    if (lw <= 0 || lh <= 0) return;

    if (this.lightCanvas.width !== lw || this.lightCanvas.height !== lh) {
      this.lightCanvas.width = lw;
      this.lightCanvas.height = lh;
    }

    const img = this.lightCtx.createImageData(lw, lh);
    const data = img.data;
    const sr = (SHADOW_BASE_HEX >> 16) & 255;
    const sg = (SHADOW_BASE_HEX >> 8) & 255;
    const sb = SHADOW_BASE_HEX & 255;

    const pmx = p.px - vp.x;
    const pmy = p.py - vp.y;
    const flicker = 0.25 * Math.sin(nowMs * 0.009) + 0.15 * Math.cos(nowMs * 0.023);
    const torchRad = Math.max(3.2, (p.lite || 2) + 3.2 + flicker);

    for (let my = minMy; my <= maxMy; my++) {
      for (let mx = minMx; mx <= maxMx; mx++) {
        const idx = my * mr.w + mx;
        const losCh = los[idx] || "0";
        const cellCh = cells[idx] || "G";
        const emissiveTile = cellCh === "L" || cellCh === "S" || cellCh === "M" || cellCh === "m";
        const dist = Math.hypot(mx - pmx, my - pmy);

        let darkness = 0.0;
        if (losCh === "0" || cellCh === "0") darkness = 1.0;
        else if (losCh === "1") darkness = emissiveTile ? 0.35 : 0.72;
        else if (losCh === "2") darkness = emissiveTile ? 0.2 : 0.52;
        else {
          const falloff = Math.max(0, Math.min(1, (dist - 1.5) / torchRad));
          darkness = emissiveTile ? falloff * 0.25 : falloff * 0.45;
        }

        const basePy = (my - minMy) * sub;
        const basePx = (mx - minMx) * sub;
        for (let sy = 0; sy < sub; sy++) {
          const py = basePy + sy;
          for (let sx = 0; sx < sub; sx++) {
            const px = basePx + sx;
            const bayer = BAYER_4X4[(py & 3) * 4 + (px & 3)];
            let alpha = 0;
            if (darkness >= 0.98) alpha = 235;
            else if (darkness > bayer) alpha = darkness > 0.65 ? 168 : darkness > 0.35 ? 115 : 68;
            if (alpha === 0) continue;
            const out = (py * lw + px) * 4;
            data[out] = sr;
            data[out + 1] = sg;
            data[out + 2] = sb;
            data[out + 3] = alpha;
          }
        }
      }
    }

    this.lightCtx.putImageData(img, 0, 0);
    ctx.drawImage(this.lightCanvas, camX + minMx * tileDraw, camY + minMy * tileDraw, visW * tileDraw, visH * tileDraw);
  }

  renderBannerRow(ctx, rowIdx, x, y, w, h) {
    ctx.fillStyle = "rgba(20, 16, 25, 0.94)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(148, 163, 184, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, rowIdx === 0 ? y + h : y);
    ctx.lineTo(x + w, rowIdx === 0 ? y + h : y);
    ctx.stroke();

    const base = rowIdx * this.cols * 4;
    let text = "", firstAttr = 1, found = false;
    for (let cx = 0; cx < this.cols; cx++) {
      const a = this.grid[base + cx * 4], c = this.grid[base + cx * 4 + 1];
      const ch = c >= 32 && c < 127 ? String.fromCharCode(c) : " ";
      if (!found && ch !== " ") { firstAttr = a; found = true; }
      text += ch;
    }
    text = text.trimEnd();
    if (!text) return;
    ctx.font = `600 13px "Cascadia Code", Consolas, monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = this.colorCss(firstAttr);
    ctx.fillText(text, x + 12, y + h / 2);
  }

  renderTermMode(ctx, W, H, nowMs) {
    const availW = Math.max(320, W - 32), availH = Math.max(200, H - 24);
    const cellH = Math.max(12, Math.floor(availH / this.rows));
    const cellW = Math.max(7, Math.min(Math.floor(availW / this.cols), Math.floor(cellH * 0.62)));
    const gridW = cellW * this.cols, gridH = cellH * this.rows;
    const offsetX = Math.floor((W - gridW) / 2);
    const offsetY = Math.floor((H - gridH) / 2);

    this.layout = { mode: "term", offsetX, offsetY, cellW, cellH, mapX: 0, mapY: 0, mapW: this.cols, mapH: this.rows, camX: offsetX, camY: offsetY };

    ctx.fillStyle = "#141019";
    ctx.fillRect(offsetX - 8, offsetY - 6, gridW + 16, gridH + 12);
    ctx.strokeStyle = "rgba(148, 163, 184, 0.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(offsetX - 8, offsetY - 6, gridW + 16, gridH + 12);

    if (this.hoverCell && !this.hoverCell.inMap) {
      ctx.fillStyle = "rgba(79, 209, 197, 0.09)";
      ctx.fillRect(offsetX, offsetY + this.hoverCell.y * cellH, gridW, cellH);
    }

    ctx.font = `500 ${Math.max(11, Math.floor(cellH * 0.78))}px "Cascadia Code", Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.imageSmoothingEnabled = false;

    const graf = this.state?.graf || "overhaul";
    const sheet = graf === "proc32" ? this.sheets.proc32 : graf === "old" ? this.sheets.old : null;

    for (let y = 0; y < this.rows; y++) {
      const base = y * this.cols * 4, py = offsetY + y * cellH;
      for (let x = 0; x < this.cols; x++) {
        const idx = base + x * 4, a = this.grid[idx], c = this.grid[idx + 1], ta = this.grid[idx + 2], tc = this.grid[idx + 3];
        const px = offsetX + x * cellW;

        if ((a & 0x80) && (c & 0x80) && (graf === "overhaul" || graf === "new")) {
          const rem = this.atlas.getRemastered16(a & 0x7f, c & 0x7f, 24, 24);
          if (rem) { ctx.drawImage(rem, px, py, cellW, cellH); continue; }
        }
        if (sheet && sheet.loaded && (a & 0x80) && (c & 0x80)) {
          const ts = sheet.tileSize;
          if ((ta & 0x80) && (tc & 0x80)) ctx.drawImage(sheet.img, (tc & 0x7f) * ts, (ta & 0x7f) * ts, ts, ts, px, py, cellW, cellH);
          ctx.drawImage(sheet.img, (c & 0x7f) * ts, (a & 0x7f) * ts, ts, ts, px, py, cellW, cellH);
        } else if (c > 32 && c < 127) {
          ctx.fillStyle = this.colorCss(a);
          ctx.fillText(String.fromCharCode(c), px + cellW * 0.5, py + cellH * 0.52);
        }
      }
    }

    if (this.cursor.v && Math.floor(nowMs / 480) % 2 === 0) {
      ctx.strokeStyle = "#4fd1c5";
      ctx.lineWidth = 2;
      ctx.strokeRect(offsetX + this.cursor.x * cellW + 1, offsetY + this.cursor.y * cellH + 1, cellW - 2, cellH - 2);
    }
  }
}
