// Clean Base HTML5 Canvas Renderer for FrogComposband Web Edition (pre-overhaul checkpoint)

export class GameRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });

    this.cols = 108;
    this.rows = 36;
    this.colors = [];
    this.initDefaultPalette();

    this.grid = new Uint8Array(this.cols * this.rows * 4);
    this.cursor = { x: 0, y: 0, v: false };
    this.state = { gen: false, dungeon: false, icky: true, ctx: 0, graf: "proc32" };

    this.sheets = {
      proc32: { img: new Image(), tileSize: 32, loaded: false },
      new: { img: new Image(), tileSize: 16, loaded: false },
      old: { img: new Image(), tileSize: 8, loaded: false },
    };
    this.sheets.proc32.img.onload = () => { this.sheets.proc32.loaded = true; };
    this.sheets.new.img.onload = () => { this.sheets.new.loaded = true; };
    this.sheets.old.img.onload = () => { this.sheets.old.loaded = true; };
    this.sheets.proc32.img.src = "/tiles/32x32.png";
    this.sheets.new.img.src = "/tiles/16x16.png";
    this.sheets.old.img.src = "/tiles/8x8.png";

    this.zoom = 1.0;
    this.fxEnabled = true;
    this.hoverCell = null;
    this.particles = [];
    this.shakeTime = 0;
    this.shakeAmp = 0;

    this.layout = {
      mode: "term",
      offsetX: 0,
      offsetY: 0,
      cellW: 16,
      cellH: 22,
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
      [10, 12, 18], [238, 242, 248], [148, 163, 184], [249, 115, 22],
      [229, 83, 75], [63, 185, 80], [76, 154, 255], [194, 134, 72],
      [75, 85, 99], [203, 213, 225], [192, 132, 252], [250, 204, 21],
      [251, 113, 133], [110, 231, 183], [79, 209, 197], [243, 208, 163],
    ];
    this.colors = Array.from({ length: 256 }, (_, i) => base[i % 16]);
  }

  stepZoom(dir) {
    const next = Math.max(0.6, Math.min(2.6, Math.round((this.zoom + (dir > 0 ? 0.15 : -0.15)) * 100) / 100));
    this.zoom = next;
    return next;
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
    ctx.fillStyle = "#05070c";
    ctx.fillRect(0, 0, W, H);
    if (this.isMapMode()) this.renderMapMode(ctx, W, H, nowMs);
    else this.renderTermMode(ctx, W, H, nowMs);
    ctx.restore();
  }

  getActiveSheet() {
    const g = this.state?.graf || "proc32";
    if (g === "proc32" && this.sheets.proc32.loaded) return this.sheets.proc32;
    if (g === "new" && this.sheets.new.loaded) return this.sheets.new;
    if (g === "old" && this.sheets.old.loaded) return this.sheets.old;
    return null;
  }

  renderMapMode(ctx, W, H) {
    const mr = this.state.mapRect;
    const topBarH = 28, botBarH = 26;
    const availH = Math.max(120, H - topBarH - botBarH);
    const fitSize = Math.max(14, Math.min(W / mr.w, availH / mr.h));
    const tileDraw = Math.round(fitSize * this.zoom);
    const totalMapW = mr.w * tileDraw;
    const totalMapH = mr.h * tileDraw;
    let camX = Math.floor((W - totalMapW) / 2);
    let camY = Math.floor(topBarH + (availH - totalMapH) / 2);

    const p = this.state.player, vp = this.state.vp;
    if (p && vp && (totalMapW > W || totalMapH > availH)) {
      if (totalMapW > W) camX = Math.round(Math.min(0, Math.max(W - totalMapW, W / 2 - (p.px - vp.x + 0.5) * tileDraw)));
      if (totalMapH > availH) camY = Math.round(Math.min(topBarH, Math.max(topBarH + availH - totalMapH, topBarH + availH / 2 - (p.py - vp.y + 0.5) * tileDraw)));
    }

    this.layout = { mode: "map", offsetX: camX, offsetY: camY, cellW: tileDraw, cellH: tileDraw, mapX: mr.x, mapY: mr.y, mapW: mr.w, mapH: mr.h, camX, camY };
    const sheet = this.getActiveSheet();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, topBarH, W, availH);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.font = `700 ${Math.max(11, Math.floor(tileDraw * 0.78))}px "Cascadia Code", Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let my = 0; my < mr.h; my++) {
      const uy = mr.y + my, dy = camY + my * tileDraw;
      for (let mx = 0; mx < mr.w; mx++) {
        const ux = mr.x + mx, dx = camX + mx * tileDraw;
        const idx = (uy * this.cols + ux) * 4;
        const a = this.grid[idx], c = this.grid[idx + 1], ta = this.grid[idx + 2], tc = this.grid[idx + 3];
        if (sheet && (a & 0x80) && (c & 0x80)) {
          const ts = sheet.tileSize;
          if ((ta & 0x80) && (tc & 0x80)) {
            ctx.drawImage(sheet.img, (tc & 0x7f) * ts, (ta & 0x7f) * ts, ts, ts, dx, dy, tileDraw, tileDraw);
          }
          ctx.drawImage(sheet.img, (c & 0x7f) * ts, (a & 0x7f) * ts, ts, ts, dx, dy, tileDraw, tileDraw);
        } else if (c > 32 && c < 127) {
          ctx.fillStyle = this.colorCss(a);
          ctx.fillText(String.fromCharCode(c), dx + tileDraw * 0.5, dy + tileDraw * 0.52);
        }
      }
    }
    ctx.restore();
    this.renderBannerRow(ctx, 0, 0, 0, W, topBarH);
    this.renderBannerRow(ctx, this.rows - 1, 0, H - botBarH, W, botBarH);
  }

  renderBannerRow(ctx, rowIdx, x, y, w, h) {
    ctx.fillStyle = "rgba(8, 12, 20, 0.92)";
    ctx.fillRect(x, y, w, h);
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
    const offsetX = Math.floor((W - cellW * this.cols) / 2);
    const offsetY = Math.floor((H - cellH * this.rows) / 2);
    this.layout = { mode: "term", offsetX, offsetY, cellW, cellH, mapX: 0, mapY: 0, mapW: this.cols, mapH: this.rows, camX: offsetX, camY: offsetY };
    ctx.font = `500 ${Math.max(11, Math.floor(cellH * 0.78))}px "Cascadia Code", Consolas, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let y = 0; y < this.rows; y++) {
      const base = y * this.cols * 4, py = offsetY + y * cellH;
      for (let x = 0; x < this.cols; x++) {
        const idx = base + x * 4, a = this.grid[idx], c = this.grid[idx + 1];
        if (c > 32 && c < 127) {
          ctx.fillStyle = this.colorCss(a);
          ctx.fillText(String.fromCharCode(c), offsetX + x * cellW + cellW * 0.5, py + cellH * 0.52);
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
