// Renders an atmospheric pixel-art dungeon vignette on the Title Screen
// using the game's actual FrogRemasterAtlas terrain and sprite engine.

import { FrogRemasterAtlas } from "./FrogRemasterAtlas.js";

export function startTitleDiorama(canvas) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const atlas = new FrogRemasterAtlas(null, 24);
  const legacy = new Image();
  legacy.onload = () => atlas.attachLegacyImage(legacy);
  legacy.src = "/tiles/16x16.png";

  // 13x12 miniature dungeon sanctum diorama (edge-to-edge cover)
  const MAP = [
    "WWWWWWWWWWWWW",
    "WGGGGGGGGGGGW",
    "WWWWQWWWWqWWW",
    "WGGGGGGGGGGGW",
    "WG~GGGGGGG<GW",
    "WGGGDGGGGGGGW",
    "WMGGGGGGGGGGW",
    "WGGGGGGGgGGGW",
    "WGGGGGGGGGGGW",
    "WGG>GGGGGGTGW",
    "WWWWmWWWWWWWW",
    "WGGGGGGGGGGGW",
  ];

  const charToFeat = (ch) => {
    switch (ch) {
      case "W": return "wall_granite";
      case "Q": return "wall_quartz";
      case "q": return "wall_quartz_gold";
      case "M": return "wall_magma";
      case "m": return "wall_magma_gold";
      case "D": return "door_closed";
      case "<": return "stairs_up";
      case ">": return "stairs_down";
      case "~": return "water";
      case "g": return "grass";
      case "T": return "tree";
      default: return "floor";
    }
  };
  const isWall = (ch) => "WQqMm".includes(ch);

  let raf = 0;
  let stopped = false;

  const draw = (nowMs) => {
    if (stopped) return;
    raf = requestAnimationFrame(draw);

    const rect = canvas.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const tw = Math.floor(rect.width * dpr);
    const th = Math.floor(rect.height * dpr);
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw;
      canvas.height = th;
    }

    const W = rect.width;
    const H = rect.height;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#0b0910";
    ctx.fillRect(0, 0, W, H);

    const rows = MAP.length;
    const cols = MAP[0].length;
    const tile = Math.max(28, Math.ceil(Math.max(W / cols, H / rows)));
    const ox = Math.floor((W - cols * tile) / 2);
    const oy = Math.floor((H - rows * tile) / 2);
    const animStep = Math.floor(nowMs / 650) % 2;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const ch = MAP[y][x];
        const feat = charToFeat(ch);
        const southCh = y + 1 < rows ? MAP[y + 1][x] : "W";
        const southFloor = !isWall(southCh);
        const seed = ((x * 73 + y * 139) & 7) + (feat === "water" ? animStep * 16 : 0);
        const img = atlas.getTerrainTile(feat, seed, southFloor);
        ctx.drawImage(img, ox + x * tile, oy + y * tile, tile, tile);
      }
    }

    // Stamp authentic game sprites: Hero, Dragon, Chest/Loot, Potions, Sword
    const hero = atlas.getCreatureSprite("player", 64, 1, 0);
    const wyrm = atlas.getCreatureSprite("mon", 68, 4, 512); // Red Dragon
    const mimic = atlas.getCreatureSprite("mon", 76, 10, 412); // Lich/Caster
    const potion = atlas.getItemSprite(75, 33, 11, 10, 1);
    const scroll = atlas.getItemSprite(70, 63, 1, 12, 2);
    const blade = atlas.getItemSprite(22, 124, 9, 25, 3);
    const gold = atlas.getItemSprite(127, 36, 11, 30, 0);

    const stamp = (img, gx, gy) => {
      if (img) ctx.drawImage(img, ox + gx * tile, oy + gy * tile, tile, tile);
    };

    stamp(hero, 4, 5);
    stamp(blade, 5, 5);
    stamp(potion, 3, 6);
    stamp(scroll, 5, 6);
    stamp(gold, 8, 3);
    stamp(wyrm, 9, 4);
    stamp(mimic, 8, 6);

    // Subtle warm torchlight vignette centered on the hero
    const hx = ox + 4.5 * tile;
    const hy = oy + 5.5 * tile;
    const flicker = 0.94 + 0.06 * Math.sin(nowMs * 0.006);
    const grad = ctx.createRadialGradient(hx, hy, tile * 0.8, hx, hy, Math.max(W, H) * 0.68 * flicker);
    grad.addColorStop(0, "rgba(229, 181, 79, 0.08)");
    grad.addColorStop(0.5, "rgba(11, 9, 16, 0.25)");
    grad.addColorStop(1, "rgba(11, 9, 16, 0.88)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    ctx.restore();
  };

  raf = requestAnimationFrame(draw);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}
