// Canvas Map Renderer hooked with FrogRemasterAtlas (Non-Destructive Remaster)
// - Quiet, low-contrast dungeon floors (#1E1C29) for instant readability
// - 100% preserved 16x16 hand-drawn monsters & items via remaster16xSprite()
// - Complete 14+ Frogcomposband terrain & ore vein coverage via generateCleanTerrainTile()
// - Seed-varied fallback synthesizer ONLY for entities lacking a 16x16 bitmap

import { FrogRemasterAtlas } from "./FrogRemasterAtlas.js";

const ZOOM_STEPS = [0.5, 1.0, 1.5, 2.0, 3.0];

function mapCellToFeatureType(cellCh, ta, tc) {
  switch (cellCh) {
    case "W": return "wall_granite";
    case "M": return "wall_magma";
    case "Q": return "wall_quartz";
    case "m": return "wall_magma_gold";
    case "q": return "wall_quartz_gold";
    case "P": return "wall_perm";
    case "R": return "rubble";
    case "D": return "door_closed";
    case "d": return "door_open";
    case "<": return "stairs_up";
    case ">": return "stairs_down";
    case "^": return "trap";
    case "~": return "water";
    case "w": return "deepwater";
    case "L": return "lava";
    case "g": return "grass";
    case "T": return "tree";
    case "S": return "shop";
    case "G": return "floor";
  }

  // Coordinate fallback from 16x16.png graf-new.prf
  if ((ta & 0x80) && (tc & 0x80)) {
    const row = ta & 0x7f;
    const col = tc & 0x7f;
    if (row === 0) {
      if (col >= 1 && col <= 3) return "floor";
      if (col >= 4 && col <= 6) return "wall_granite";
      if (col >= 7 && col <= 9) return "wall_quartz";
      if (col >= 10 && col <= 12) return "wall_quartz_gold";
      if (col >= 13 && col <= 15) return "wall_magma";
      if (col >= 16 && col <= 18) return "wall_magma_gold";
      if (col >= 19 && col <= 21) return "wall_perm";
      if (col >= 28 && col <= 30) return "rubble";
    }
  }
  return "floor";
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

    this.atlas = new FrogRemasterAtlas(null, 24);

    this.sheets = {
      proc32: { img: new Image(), tileSize: 32, loaded: false },
      new: { img: new Image(), tileSize: 16, loaded: false },
      old: { img: new Image(), tileSize: 8, loaded: false },
    };
    this.sheets.proc32.img.onload = () => { this.sheets.proc32.loaded = true; };
    this.sheets.new.img.onload = () => {
      this.sheets.new.loaded = true;
      this.atlas.attachLegacyImage(this.sheets.new.img);
    };
    this.sheets.old.img.onload = () => { this.sheets.old.loaded = true; };
    this.sheets.proc32.img.src = "/tiles/32x32.png";
    this.sheets.new.img.src = "/tiles/16x16.png";
    this.sheets.old.img.src = "/tiles/8x8.png";

    this.zoom = 2.0;
    this.fxEnabled = true;
    this.hoverCell = null;

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
        for (let i = 0; i < limit; i++) this.grid[base + i] = rowArr[i + 1];
      }
    }
    if (msg.state) this.state = msg.state;
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

  render(nowMs) {
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

    if (this.isMapMode()) {
      this.renderMapMode(ctx, W, H, nowMs);
    } else {
      this.renderTermMode(ctx, W, H, nowMs);
    }
    ctx.restore();
  }

  renderMapMode(ctx, W, H, nowMs) {
    const mr = this.state.mapRect;
    const topBarH = 28;
    const botBarH = 26;
    const availH = Math.max(120, H - topBarH - botBarH);

    const graf = this.state.graf || "overhaul";
    const baseLogical = graf === "proc32" ? 32 : 24;
    const tileDraw = Math.max(14, Math.round(baseLogical * this.zoom));

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

    this.layout = { mode: "map", offsetX: camX, offsetY: camY, cellW: tileDraw, cellH: tileDraw, mapX: mr.x, mapY: mr.y, mapW: mr.w, mapH: mr.h, camX, camY };

    const cells = this.state.cells || "";
    const los = this.state.los || "";
    const animStep = Math.floor(nowMs / 650) % 2;

    const cellAt = (mx, my) => {
      if (mx < 0 || mx >= mr.w || my < 0 || my >= mr.h) return "0";
      return cells[my * mr.w + mx] || "G";
    };
    const isSolidWall = (ch) => "WMQmqP".includes(ch);

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

    // Index visible floor objects & monsters for clean lookup
    const objMap = new Map();
    if (Array.isArray(this.state.objs)) {
      for (const o of this.state.objs) objMap.set(`${o[0]},${o[1]}`, o);
    }
    const monMap = new Map();
    if (Array.isArray(this.state.mons)) {
      for (const m of this.state.mons) monMap.set(`${m[0]},${m[1]}`, m);
    }

    const pUx = p && vp ? mr.x + (p.px - vp.x) : -1;
    const pUy = p && vp ? mr.y + (p.py - vp.y) : -1;

    ctx.font = `700 ${Math.max(10, Math.floor(tileDraw * 0.78))}px "Cascadia Code", Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let my = minMy; my <= maxMy; my++) {
      const uy = mr.y + my;
      const dy = camY + my * tileDraw;
      for (let mx = minMx; mx <= maxMx; mx++) {
        const ux = mr.x + mx;
        const dx = camX + mx * tileDraw;
        const idx = (uy * this.cols + ux) * 4;
        const a = this.grid[idx];
        const c = this.grid[idx + 1];
        const ta = this.grid[idx + 2];
        const tc = this.grid[idx + 3];
        const ch = cellAt(mx, my);
        const losCh = los[my * mr.w + mx] || "3";

        if (ch === "0" && losCh === "0") continue;

        if (useAscii) {
          const glyph = c >= 32 && c < 127 ? String.fromCharCode(c) : " ";
          if (glyph !== " ") {
            ctx.fillStyle = this.colorCss(a);
            ctx.fillText(glyph, dx + tileDraw * 0.5, dy + tileDraw * 0.52);
          }
          continue;
        }

        // 1. Terrain Layer
        if (useProc32 || useOld8) {
          const sheet = useProc32 ? this.sheets.proc32 : this.sheets.old;
          const ts = sheet.tileSize;
          if ((ta & 0x80) && (tc & 0x80)) {
            ctx.drawImage(sheet.img, (tc & 0x7f) * ts, (ta & 0x7f) * ts, ts, ts, dx, dy, tileDraw, tileDraw);
          }
        } else if (useRemaster16 && (ta & 0x80) && (tc & 0x80)) {
          const remTerrain = this.atlas.getRemastered16x(ta & 0x7f, tc & 0x7f);
          if (remTerrain) {
            ctx.drawImage(remTerrain, dx, dy, tileDraw, tileDraw);
          }
        } else {
          // Quiet floor / clean 14-type Frogcomposband terrain
          const featType = mapCellToFeatureType(ch, ta, tc);
          const southCh = cellAt(mx, my + 1);
          const hasSouthFloor = !isSolidWall(southCh) && southCh !== "0";
          const seed = ((mx * 73 + my * 139) & 7) + (featType === "water" || featType === "lava" ? animStep * 16 : 0);
          const terrImg = this.atlas.getTerrainTile(featType, seed, hasSouthFloor);
          ctx.drawImage(terrImg, dx, dy, tileDraw, tileDraw);
        }

        // 2. Entity / Foreground Layer (Item, Monster, Player)
        const key = `${ux},${uy}`;
        const mon = monMap.get(key);
        const obj = objMap.get(key);
        const isPlayer = ux === pUx && uy === pUy;

        if (useProc32 || useOld8) {
          const sheet = useProc32 ? this.sheets.proc32 : this.sheets.old;
          const ts = sheet.tileSize;
          if ((a & 0x80) && (c & 0x80) && (a !== ta || c !== tc)) {
            ctx.drawImage(sheet.img, (c & 0x7f) * ts, (a & 0x7f) * ts, ts, ts, dx, dy, tileDraw, tileDraw);
          }
        } else if (useOverhaul) {
          // Pure 5-Buffer Procedural Pixel Engine (10 Archetype Grids + 4 DNA Mutations + Parametric NMM Items)
          if (obj) {
            const [, , tval, sval, kIdx, dAttr] = obj;
            const sym = tval === 75 ? 33 : tval === 70 ? 63 : tval === 127 ? 36 : tval >= 20 && tval <= 23 ? 124 : tval === 45 ? 61 : tval === 7 ? 126 : 91;
            const itemImg = this.atlas.getItemSprite(tval, sym, dAttr, kIdx || sval);
            ctx.drawImage(itemImg, dx, dy, tileDraw, tileDraw);
          }
          if (mon) {
            const [, , , , , , , dChar, rIdx, dAttr] = mon;
            const monImg = this.atlas.getCreatureSprite("mon", dChar, dAttr, rIdx);
            ctx.drawImage(monImg, dx, dy, tileDraw, tileDraw);
          }
          if (isPlayer) {
            const pImg = this.atlas.getCreatureSprite("player", 64, 6, p.pclass || 0);
            ctx.drawImage(pImg, dx, dy, tileDraw, tileDraw);
          }
        } else if (useRemaster16) {
          let drawn = false;
          if ((a & 0x80) && (c & 0x80) && (a !== ta || c !== tc || isPlayer || mon || obj)) {
            const rem = this.atlas.getRemastered16x(a & 0x7f, c & 0x7f);
            if (rem) {
              ctx.drawImage(rem, dx, dy, tileDraw, tileDraw);
              drawn = true;
            }
          }
          if (!drawn) {
            if (isPlayer) {
              ctx.drawImage(this.atlas.getCreatureSprite("player", 64, 6, p.pclass || 0), dx, dy, tileDraw, tileDraw);
            } else if (mon) {
              const [, , , , , , , dChar, rIdx, dAttr, xAttr, xChar] = mon;
              let sprite = (xAttr & 0x80) && (xChar & 0x80) ? this.atlas.getRemastered16x(xAttr & 0x7f, xChar & 0x7f) : null;
              if (!sprite) sprite = this.atlas.getCreatureSprite("mon", dChar, dAttr, rIdx);
              ctx.drawImage(sprite, dx, dy, tileDraw, tileDraw);
            } else if (obj) {
              const [, , tval, sval, kIdx, dAttr, xAttr, xChar] = obj;
              let sprite = (xAttr & 0x80) && (xChar & 0x80) ? this.atlas.getRemastered16x(xAttr & 0x7f, xChar & 0x7f) : null;
              if (!sprite) {
                const sym = tval === 75 ? 33 : tval === 70 ? 63 : tval === 127 ? 36 : tval >= 20 && tval <= 23 ? 124 : tval === 45 ? 61 : tval === 7 ? 126 : 91;
                sprite = this.atlas.getItemSprite(tval, sym, dAttr, kIdx || sval);
              }
              ctx.drawImage(sprite, dx, dy, tileDraw, tileDraw);
            }
          }
        }

        // 3. Subtle Fog-of-War dimness for out-of-sight remembered tiles
        if (this.fxEnabled && (losCh === "1" || losCh === "2")) {
          ctx.fillStyle = losCh === "1" ? "rgba(20, 16, 25, 0.56)" : "rgba(20, 16, 25, 0.34)";
          ctx.fillRect(dx, dy, tileDraw, tileDraw);
        }

        // 4. Monster Attitude & HP Bar Overlays
        if (mon) {
          const [, , hpPct, att, sleep, uniq] = mon;
          if (att === 2 || att === 1) {
            ctx.strokeStyle = att === 2 ? "rgba(146, 196, 116, 0.85)" : "rgba(84, 162, 255, 0.85)";
            ctx.lineWidth = 2;
            ctx.strokeRect(dx + 1, dy + 1, tileDraw - 2, tileDraw - 2);
          } else if (uniq) {
            ctx.strokeStyle = "rgba(250, 224, 107, 0.82)";
            ctx.lineWidth = 1.5;
            ctx.strokeRect(dx + 1, dy + 1, tileDraw - 2, tileDraw - 2);
          }
          if (hpPct < 100) {
            const bw = Math.max(12, tileDraw - 6);
            const bh = 3.5;
            const bx = dx + Math.floor((tileDraw - bw) / 2);
            const by = dy + tileDraw - 5;
            ctx.fillStyle = "#141019";
            ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
            ctx.fillStyle = hpPct > 55 ? "#568f56" : hpPct > 25 ? "#deb841" : "#c93640";
            ctx.fillRect(bx, by, Math.round((bw * Math.max(0, hpPct)) / 100), bh);
          }
          if (sleep) {
            ctx.font = `700 ${Math.max(9, Math.floor(tileDraw * 0.32))}px monospace`;
            ctx.fillStyle = "#b8f2ff";
            ctx.fillText("z", dx + tileDraw - 6, dy + 7);
          }
        }
      }
    }

    // Target Crosshair
    if (p && p.target && vp) {
      const tx = camX + (p.target.x - vp.x) * tileDraw;
      const ty = camY + (p.target.y - vp.y) * tileDraw;
      const pulse = 0.65 + 0.35 * Math.sin(nowMs * 0.008);
      ctx.strokeStyle = `rgba(255, 128, 120, ${pulse})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(tx + 1, ty + 1, tileDraw - 2, tileDraw - 2);
    }

    // Hover Reticle
    if (this.hoverCell && this.hoverCell.inMap) {
      const hx = camX + (this.hoverCell.x - mr.x) * tileDraw;
      const hy = camY + (this.hoverCell.y - mr.y) * tileDraw;
      const arm = Math.max(6, Math.floor(tileDraw * 0.28));
      ctx.strokeStyle = "rgba(110, 231, 183, 0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx + 1, hy + arm); ctx.lineTo(hx + 1, hy + 1); ctx.lineTo(hx + arm, hy + 1);
      ctx.moveTo(hx + tileDraw - arm, hy + 1); ctx.lineTo(hx + tileDraw - 1, hy + 1); ctx.lineTo(hx + tileDraw - 1, hy + arm);
      ctx.moveTo(hx + 1, hy + tileDraw - arm); ctx.lineTo(hx + 1, hy + tileDraw - 1); ctx.lineTo(hx + arm, hy + tileDraw - 1);
      ctx.moveTo(hx + tileDraw - arm, hy + tileDraw - 1); ctx.lineTo(hx + tileDraw - 1, hy + tileDraw - 1); ctx.lineTo(hx + tileDraw - 1, hy + tileDraw - arm);
      ctx.stroke();
    }

    ctx.restore();
    this.renderBannerRow(ctx, 0, 0, 0, W, topBarH);
    this.renderBannerRow(ctx, this.rows - 1, 0, H - botBarH, W, botBarH);
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
          const rem = this.atlas.getRemastered16x(a & 0x7f, c & 0x7f);
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
