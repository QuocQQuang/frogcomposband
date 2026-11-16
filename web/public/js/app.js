import { SoundEngine } from "./audio.js";
import { GameRenderer } from "./renderer.js";
import { InputController } from "./input.js";

const CTX_LABELS = [
  "Command",
  "Map",
  "Targeting",
  "Menu",
  "Shop",
  "Inventory",
  "Character Birth",
  "Prompt",
];

class FrogWebApp {
  constructor() {
    this.canvas = document.getElementById("game-canvas");
    this.stage = document.getElementById("canvas-stage");
    this.sound = new SoundEngine();
    this.renderer = new GameRenderer(this.canvas);
    this.ws = null;
    this.connected = false;
    this.running = false;
    this.lastMousePos = { x: 0, y: 0 };

    this.input = new InputController({
      canvas: this.canvas,
      renderer: this.renderer,
      send: (msg) => this.send(msg),
      onToggleControlMode: () => this.toggleControlMode(),
      onZoomChange: (z) => this.updateZoomLabel(z),
      onHideTooltip: () => this.hideTooltip(),
    });

    this.bindUI();
    this.connectWebSocket();
    this.refreshSaves();
    this.startRenderLoop();
  }

  bindUI() {
    // Track pointer position for tooltip placement
    this.stage.addEventListener("mousemove", (e) => {
      const rect = this.stage.getBoundingClientRect();
      this.lastMousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const tt = document.getElementById("hover-tooltip");
      if (!tt.classList.contains("hidden")) {
        this.positionTooltip(tt);
      }
    });

    // Graphics mode switcher
    document.querySelectorAll(".seg-btn[data-graf]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.graf;
        document.querySelectorAll(".seg-btn[data-graf]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.send({ type: "graf", mode });
      });
    });

    // Control mode toggle
    document.getElementById("btn-ctrl-mode").addEventListener("click", () => this.toggleControlMode());

    // FX toggle
    const fxBtn = document.getElementById("btn-fx");
    fxBtn.addEventListener("click", () => {
      this.renderer.fxEnabled = !this.renderer.fxEnabled;
      fxBtn.classList.toggle("active", this.renderer.fxEnabled);
    });

    // Zoom buttons (crisp pixel zoom steps)
    document.getElementById("btn-zoom-in").addEventListener("click", () => {
      this.updateZoomLabel(this.renderer.stepZoom(1));
    });
    document.getElementById("btn-zoom-out").addEventListener("click", () => {
      this.updateZoomLabel(this.renderer.stepZoom(-1));
    });

    // Sound toggle
    const sndBtn = document.getElementById("btn-sound");
    sndBtn.addEventListener("click", () => {
      const next = !this.sound.enabled;
      this.sound.setEnabled(next);
      sndBtn.classList.toggle("active", next);
      sndBtn.textContent = next ? "🔊" : "🔇";
    });

    // On-screen D-Pad toggle
    const dpadBtn = document.getElementById("btn-dpad");
    const dpad = document.getElementById("touch-dpad");
    dpadBtn.addEventListener("click", () => {
      const show = dpad.classList.toggle("hidden");
      dpadBtn.classList.toggle("active", !show);
    });

    // Sidebar toggle
    const sbBtn = document.getElementById("btn-sidebar");
    const wsEl = document.querySelector(".workspace");
    sbBtn.addEventListener("click", () => {
      const hidden = wsEl.classList.toggle("no-sidebars");
      sbBtn.classList.toggle("active", !hidden);
    });

    // Lobby button
    document.getElementById("btn-lobby").addEventListener("click", () => {
      this.showLobby();
    });

    // Lobby start new hero
    const startNew = () => {
      const nameInput = document.getElementById("new-hero-name");
      const name = (nameInput.value || "PLAYER").trim();
      this.startSession("new", name);
    };
    document.getElementById("btn-start-new").addEventListener("click", startNew);
    document.getElementById("new-hero-name").addEventListener("keydown", (e) => {
      if (e.key === "Enter") startNew();
    });

    // Tabs (Radar / Pack / Gear)
    document.querySelectorAll(".tab-btn[data-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.tab;
        document.querySelectorAll(".tab-btn[data-tab]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        ["radar", "inven", "equip"].forEach((id) => {
          document.getElementById(`tab-${id}`).classList.toggle("hidden", id !== target);
        });
      });
    });

    // Bottom action hotbar & prompt pills & D-Pad
    document.querySelectorAll("[data-cmd]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.sound.ensureCtx();
        this.send({ type: "cmd", str: btn.dataset.cmd });
      });
    });
    document.querySelectorAll("[data-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.sound.ensureCtx();
        this.send({ type: "key", code: Number(btn.dataset.key) });
      });
    });
    document.querySelectorAll("#touch-dpad [data-dir]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.sound.ensureCtx();
        this.send({ type: "key", code: btn.dataset.dir.charCodeAt(0) });
      });
    });
  }

  toggleControlMode() {
    const next = this.input.controlMode === "wasd" ? "classic" : "wasd";
    this.input.setControlMode(next);
    document.getElementById("lbl-ctrl-mode").textContent = next === "wasd" ? "WASD" : "Classic";
  }

  updateZoomLabel(z) {
    document.getElementById("lbl-zoom").textContent = `${Math.round(z * 100)}%`;
  }

  connectWebSocket() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      document.getElementById("conn-badge").textContent = "Ready";
    };

    ws.onclose = () => {
      this.connected = false;
      this.running = false;
      this.input.setEnabled(false);
      document.getElementById("conn-badge").textContent = "Disconnected — retrying...";
      setTimeout(() => this.connectWebSocket(), 1500);
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handleEngineMsg(msg);
    };
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  async refreshSaves() {
    const box = document.getElementById("save-list");
    try {
      const res = await fetch("/api/saves");
      const data = await res.json();
      if (!data.hasEngine) {
        box.innerHTML = `<div class="empty-hint">Engine binary missing. Run <code>build-web.cmd</code>.</div>`;
        return;
      }
      if (!data.saves || data.saves.length === 0) {
        box.innerHTML = `<div class="empty-hint">No saved games found yet. Start a new hero!</div>`;
        return;
      }
      box.innerHTML = "";
      for (const s of data.saves) {
        const btn = document.createElement("button");
        btn.className = "save-btn";
        const dt = new Date(s.mtime).toLocaleString();
        const kb = Math.max(1, Math.round(s.size / 1024));
        btn.innerHTML = `<strong>${this.escapeHtml(s.name)}</strong><small>${kb} KB · ${this.escapeHtml(dt)}</small>`;
        btn.addEventListener("click", () => this.startSession("load", s.name));
        box.appendChild(btn);
      }
    } catch {
      box.innerHTML = `<div class="empty-hint">Failed to query savefiles.</div>`;
    }
  }

  startSession(mode, name) {
    this.sound.ensureCtx();
    const activeGraf = document.querySelector(".seg-btn.active[data-graf]")?.dataset.graf || "overhaul";
    document.getElementById("lobby-modal").classList.add("hidden");
    document.getElementById("conn-badge").textContent = `Playing · ${name}`;
    this.running = true;
    this.input.setEnabled(true);
    this.send({
      type: "start",
      mode,
      name,
      cols: 108,
      rows: 36,
      graf: activeGraf,
    });
  }

  showLobby() {
    this.send({ type: "stop" });
    this.running = false;
    this.input.setEnabled(false);
    this.hideTooltip();
    document.getElementById("lobby-modal").classList.remove("hidden");
    this.refreshSaves();
  }

  handleEngineMsg(msg) {
    switch (msg.type) {
      case "init":
        this.renderer.setInit(msg);
        break;
      case "frame":
        this.renderer.applyFrame(msg);
        if (Array.isArray(msg.sounds)) {
          for (const s of msg.sounds) this.sound.play(s);
        }
        if (msg.state) this.syncHUD(msg.state);
        break;
      case "hover":
        this.updateTooltip(msg);
        break;
      case "error":
        alert(msg.msg || "Engine error");
        this.showLobby();
        break;
      case "quit":
      case "exit":
        if (this.running) this.showLobby();
        break;
    }
  }

  syncHUD(st) {
    // Graphics active pill sync
    if (st.graf) {
      const target = st.graf === "ascii" ? "none" : st.graf;
      document.querySelectorAll(".seg-btn[data-graf]").forEach((b) => {
        b.classList.toggle("active", b.dataset.graf === target);
      });
    }

    // Context badge & prompt helper pills
    const ctxBadge = document.getElementById("ctx-badge");
    const promptBar = document.getElementById("prompt-actions");
    if (!st.dungeon || st.icky) {
      ctxBadge.textContent = CTX_LABELS[st.ctx] || "Menu";
      promptBar.classList.remove("hidden");
    } else if (!st.cmdReady) {
      ctxBadge.textContent = st.ctx === 2 ? "Targeting" : "Prompt";
      promptBar.classList.remove("hidden");
    } else {
      ctxBadge.textContent = "Exploring";
      promptBar.classList.add("hidden");
    }

    const p = st.player;
    if (p) {
      document.getElementById("hero-name").textContent = p.name || "Adventurer";
      const realms = [p.r1, p.r2].filter(Boolean).join(" / ");
      document.getElementById("hero-sub").textContent = `${p.pers} ${p.race} ${p.class}${realms ? " · " + realms : ""}`;
      document.getElementById("hero-lv").textContent = `Lv ${p.lev}`;

      const hpPct = p.mhp > 0 ? Math.max(0, Math.min(100, (100 * p.chp) / p.mhp)) : 100;
      const hpBar = document.getElementById("hp-bar");
      hpBar.style.width = `${hpPct}%`;
      hpBar.classList.toggle("low", hpPct < 35);
      document.getElementById("hp-text").textContent = `${p.chp} / ${p.mhp}`;

      const spPct = p.msp > 0 ? Math.max(0, Math.min(100, (100 * p.csp) / p.msp)) : 0;
      document.getElementById("sp-bar").style.width = `${p.msp > 0 ? spPct : 100}%`;
      document.getElementById("sp-text").textContent = p.msp > 0 ? `${p.csp} / ${p.msp}` : "—";

      const span = Math.max(1, (p.nextReq || 1) - (p.curReq || 0));
      const xpPct = p.lev >= 50 ? 100 : Math.max(0, Math.min(100, ((p.exp - (p.curReq || 0)) * 100) / span));
      document.getElementById("xp-bar").style.width = `${xpPct}%`;
      document.getElementById("xp-text").textContent = `${p.exp.toLocaleString()}`;

      document.getElementById("stat-ac").textContent = `${p.ac}`;
      document.getElementById("stat-spd").textContent = p.spd >= 0 ? `+${p.spd}` : `${p.spd}`;
      document.getElementById("stat-lite").textContent = `${p.lite}`;

      document.getElementById("pill-depth").textContent = p.wild
        ? "Wilderness"
        : p.depth > 0
        ? `${p.depth * 50} ft (Lv ${p.depth})`
        : "Town";
      document.getElementById("pill-turn").textContent = p.turn.toLocaleString();
      document.getElementById("pill-gold").textContent = `${p.au.toLocaleString()} gp`;

      if (Array.isArray(p.stats)) {
        for (let i = 0; i < 6; i++) {
          document.getElementById(`st-${i}`).textContent = this.formatStat(p.stats[i]);
        }
      }

      const flagsBox = document.getElementById("status-flags");
      flagsBox.innerHTML = "";
      for (const fl of p.flags || []) {
        const el = document.createElement("span");
        el.className = `flag-pill ${fl.kind}`;
        el.textContent = fl.label;
        flagsBox.appendChild(el);
      }

      const tgtCard = document.getElementById("target-card");
      if (p.target) {
        tgtCard.classList.remove("hidden");
        document.getElementById("target-name").textContent = p.target.name;
        document.getElementById("target-hp-bar").style.width = `${p.target.hp >= 0 ? p.target.hp : 100}%`;
      } else {
        tgtCard.classList.add("hidden");
      }
    }

    // Nearby Monsters Radar
    this.syncRadar(st.mons || []);
    // Pack & Equipment
    this.syncInven(st.inven || []);
    this.syncEquip(st.equip || []);
    // Message Log
    this.syncMessages(st.msgs || []);
  }

  formatStat(val) {
    if (val <= 18) return String(val);
    return `18/${String(val - 18).padStart(2, "0")}`;
  }

  syncRadar(mons) {
    const box = document.getElementById("tab-radar");
    if (!mons.length) {
      box.innerHTML = `<div class="empty-hint">No visible creatures nearby.</div>`;
      return;
    }
    box.innerHTML = "";
    for (const m of mons) {
      const [ux, uy, hpPct, att, sleep, uniq, name] = m;
      const item = document.createElement("div");
      item.className = "list-item";
      const badge = att === 2 ? "🟢 Pet" : att === 1 ? "🔵 Ally" : uniq ? "👑 Unique" : sleep ? "💤 Sleep" : "⚔ Hostile";
      item.innerHTML = `
        <div class="list-item-row">
          <span class="item-name">${this.escapeHtml(name)}</span>
          <small style="color:var(--muted)">${badge}</small>
        </div>
        <div class="bar-track thin"><div class="bar-fill hp" style="width:${hpPct}%"></div></div>
      `;
      item.title = "Click to inspect / Ctrl+Click to target";
      item.addEventListener("click", (e) => {
        this.send({ type: "mouse", x: ux, y: uy, btn: e.ctrlKey ? 1 : 2, mods: e.ctrlKey ? 2 : 0 });
      });
      box.appendChild(item);
    }
  }

  syncInven(items) {
    const box = document.getElementById("tab-inven");
    if (!items.length) {
      box.innerHTML = `<div class="empty-hint">Pack is empty.</div>`;
      return;
    }
    box.innerHTML = "";
    for (const it of items) {
      const div = document.createElement("div");
      div.className = "list-item";
      div.innerHTML = `
        <div class="list-item-row">
          <span class="item-name"><span class="slot-tag">${it.lbl})</span>${this.escapeHtml(it.name)}</span>
          <small style="color:var(--muted)">${(it.wgt / 10).toFixed(1)}lb</small>
        </div>
      `;
      div.title = "Click to examine item";
      div.addEventListener("click", () => {
        this.send({ type: "cmd", str: "I" + it.lbl });
      });
      box.appendChild(div);
    }
  }

  syncEquip(items) {
    const box = document.getElementById("tab-equip");
    if (!items.length) {
      box.innerHTML = `<div class="empty-hint">No gear equipped.</div>`;
      return;
    }
    box.innerHTML = "";
    for (const eq of items) {
      const div = document.createElement("div");
      div.className = "list-item";
      div.style.opacity = eq.empty ? "0.55" : "1";
      div.innerHTML = `
        <div class="list-item-row">
          <span class="item-name"><span class="slot-tag">${eq.lbl})</span>${this.escapeHtml(eq.name)}</span>
        </div>
        <small style="color:var(--muted);font-size:10px">${this.escapeHtml(eq.slotName)}</small>
      `;
      if (!eq.empty) {
        div.addEventListener("click", () => {
          this.send({ type: "cmd", str: "I" + eq.lbl });
        });
      }
      box.appendChild(div);
    }
  }

  syncMessages(msgs) {
    const box = document.getElementById("msg-log");
    const wasAtBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 28;
    box.innerHTML = "";
    for (const m of msgs) {
      const div = document.createElement("div");
      div.className = "msg-entry";
      const color = this.renderer.colorCss(m.c);
      div.style.borderLeftColor = color;
      div.style.color = color;
      const countBadge = m.n > 1 ? `<span class="msg-count">×${m.n}</span>` : "";
      div.innerHTML = `${this.escapeHtml(m.s)}${countBadge}`;
      box.appendChild(div);
    }
    if (wasAtBottom) {
      box.scrollTop = box.scrollHeight;
    }
  }

  updateTooltip(msg) {
    const tt = document.getElementById("hover-tooltip");
    if (!msg.valid || !this.renderer.isMapMode()) {
      this.hideTooltip();
      return;
    }
    document.getElementById("ht-title").textContent = msg.title || "";
    const subEl = document.getElementById("ht-sub");
    subEl.textContent = msg.sub || "";
    subEl.classList.toggle("hidden", !msg.sub);

    const barWrap = document.getElementById("ht-bar-wrap");
    const barFill = document.getElementById("ht-bar-fill");
    if (typeof msg.hp === "number" && msg.hp >= 0) {
      barWrap.classList.remove("hidden");
      barFill.style.width = `${msg.hp}%`;
      barFill.style.background = msg.att === 2 ? "#4ade80" : msg.att === 1 ? "#38bdf8" : "#ef4444";
    } else {
      barWrap.classList.add("hidden");
    }

    tt.classList.remove("hidden");
    this.positionTooltip(tt);
  }

  positionTooltip(tt) {
    const stageRect = this.stage.getBoundingClientRect();
    let x = this.lastMousePos.x + 16;
    let y = this.lastMousePos.y + 16;
    if (x + 240 > stageRect.width) x = Math.max(8, this.lastMousePos.x - 240);
    if (y + 80 > stageRect.height) y = Math.max(8, this.lastMousePos.y - 80);
    tt.style.left = `${x}px`;
    tt.style.top = `${y}px`;
  }

  hideTooltip() {
    document.getElementById("hover-tooltip").classList.add("hidden");
  }

  startRenderLoop() {
    let prev = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      this.renderer.render(now, dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new FrogWebApp();
});
