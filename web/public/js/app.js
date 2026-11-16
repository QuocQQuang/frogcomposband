import { SoundEngine } from "./audio.js";
import { GameRenderer } from "./renderer.js";
import { InputController } from "./input.js";

const PREFS_KEY = "frogweb_prefs_v1";

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

function quickActionForTval(tval) {
  if (tval === 75) return { label: "Quaff", cmd: "q" };
  if (tval === 70) return { label: "Read", cmd: "r" };
  if (tval === 80) return { label: "Eat", cmd: "E" };
  if (tval === 55) return { label: "Use", cmd: "u" };
  if (tval === 65) return { label: "Aim", cmd: "a" };
  if (tval === 66) return { label: "Zap", cmd: "z" };
  if (tval >= 90 && tval <= 110) return { label: "Cast", cmd: "m" };
  if (tval >= 16 && tval <= 18) return { label: "Fire", cmd: "f" };
  if (tval >= 19 && tval <= 45) return { label: "Wear", cmd: "w" };
  return null;
}

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
    this._toastTimer = null;
    this._lastPromptSig = "";
    this._lastMsgsSig = "";
    this._logPinnedBottom = true;
    this._updatingMsgs = false;

    this.prefs = this.loadPrefs();

    this.input = new InputController({
      canvas: this.canvas,
      renderer: this.renderer,
      send: (msg) => this.send(msg),
      onToggleControlMode: () => this.toggleControlMode(),
      onZoomChange: (z) => {
        this.updateZoomLabel(z);
        this.savePref("zoom", z);
      },
      onHideTooltip: () => this.hideTooltip(),
      onShowToast: (text) => this.showToast(text),
    });

    this.applySavedPrefs();
    this.bindUI();
    this.connectWebSocket();
    this.refreshSaves();
    this.startRenderLoop();
  }

  loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    } catch {
      return {};
    }
  }

  savePref(key, val) {
    this.prefs[key] = val;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      /* ignore storage errors */
    }
  }

  applySavedPrefs() {
    if (this.prefs.graf) {
      document.querySelectorAll(".seg-btn[data-graf]").forEach((b) => {
        b.classList.toggle("active", b.dataset.graf === this.prefs.graf);
      });
    }
    if (this.prefs.controlMode) {
      this.input.setControlMode(this.prefs.controlMode);
      this.syncControlModeUI();
    }
    if (typeof this.prefs.zoom === "number") {
      this.updateZoomLabel(this.renderer.setZoom(this.prefs.zoom));
    }
    if (typeof this.prefs.fxEnabled === "boolean") {
      this.renderer.fxEnabled = this.prefs.fxEnabled;
      document.getElementById("btn-fx").classList.toggle("active", this.renderer.fxEnabled);
    }
    if (typeof this.prefs.soundEnabled === "boolean") {
      this.sound.setEnabled(this.prefs.soundEnabled);
      const sndBtn = document.getElementById("btn-sound");
      sndBtn.classList.toggle("active", this.prefs.soundEnabled);
      sndBtn.textContent = this.prefs.soundEnabled ? "🔊" : "🔇";
    }
    if (this.prefs.dpadVisible) {
      document.getElementById("touch-dpad").classList.remove("hidden");
      document.getElementById("btn-dpad").classList.add("active");
    }
    if (this.prefs.sidebarsVisible === false) {
      document.getElementById("workspace").classList.add("no-sidebars");
      document.getElementById("btn-sidebar").classList.remove("active");
    }
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

    const msgBox = document.getElementById("msg-log");
    const latestBtn = document.getElementById("btn-log-latest");
    if (msgBox) {
      msgBox.addEventListener("scroll", () => {
        if (this._updatingMsgs || msgBox.clientHeight <= 0) return;
        const dist = msgBox.scrollHeight - msgBox.scrollTop - msgBox.clientHeight;
        this._logPinnedBottom = dist < 32;
        if (latestBtn) latestBtn.classList.toggle("hidden", this._logPinnedBottom);
      });
    }
    if (latestBtn && msgBox) {
      latestBtn.addEventListener("click", () => {
        this._logPinnedBottom = true;
        latestBtn.classList.add("hidden");
        msgBox.scrollTop = msgBox.scrollHeight;
      });
    }

    // Graphics mode switcher
    document.querySelectorAll(".seg-btn[data-graf]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.graf;
        document.querySelectorAll(".seg-btn[data-graf]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.savePref("graf", mode);
        if (this.running) this.send({ type: "graf", mode });
      });
    });

    // Control mode toggle
    document.getElementById("btn-ctrl-mode").addEventListener("click", () => this.toggleControlMode());

    // FX toggle
    const fxBtn = document.getElementById("btn-fx");
    fxBtn.addEventListener("click", () => {
      this.renderer.fxEnabled = !this.renderer.fxEnabled;
      fxBtn.classList.toggle("active", this.renderer.fxEnabled);
      this.savePref("fxEnabled", this.renderer.fxEnabled);
    });

    // Zoom buttons
    document.getElementById("btn-zoom-in").addEventListener("click", () => {
      const z = this.renderer.stepZoom(1);
      this.updateZoomLabel(z);
      this.savePref("zoom", z);
      this.input.refreshHover();
    });
    document.getElementById("btn-zoom-out").addEventListener("click", () => {
      const z = this.renderer.stepZoom(-1);
      this.updateZoomLabel(z);
      this.savePref("zoom", z);
      this.input.refreshHover();
    });

    // Sound toggle
    const sndBtn = document.getElementById("btn-sound");
    sndBtn.addEventListener("click", () => {
      const next = !this.sound.enabled;
      this.sound.setEnabled(next);
      sndBtn.classList.toggle("active", next);
      sndBtn.textContent = next ? "🔊" : "🔇";
      this.savePref("soundEnabled", next);
    });

    // On-screen D-Pad toggle
    const dpadBtn = document.getElementById("btn-dpad");
    const dpad = document.getElementById("touch-dpad");
    dpadBtn.addEventListener("click", () => {
      const hidden = dpad.classList.toggle("hidden");
      dpadBtn.classList.toggle("active", !hidden);
      this.savePref("dpadVisible", !hidden);
    });

    // Sidebar toggle
    const sbBtn = document.getElementById("btn-sidebar");
    const wsEl = document.getElementById("workspace");
    sbBtn.addEventListener("click", () => {
      const hidden = wsEl.classList.toggle("no-sidebars");
      sbBtn.classList.toggle("active", !hidden);
      this.savePref("sidebarsVisible", !hidden);
    });

    // Lobby button (Safe Exit check when in dungeon)
    document.getElementById("btn-lobby").addEventListener("click", () => {
      const st = this.renderer.state || {};
      if (this.running && st.gen && st.dungeon) {
        this.openExitModal(st);
      } else {
        this.showLobby(true);
      }
    });

    // Exit confirmation modal buttons
    document.getElementById("btn-exit-save").addEventListener("click", () => {
      document.getElementById("exit-modal").classList.add("hidden");
      this.send({ type: "save_quit" });
    });
    document.getElementById("btn-exit-discard").addEventListener("click", () => {
      document.getElementById("exit-modal").classList.add("hidden");
      this.showLobby(true);
    });
    document.getElementById("btn-exit-cancel").addEventListener("click", () => {
      document.getElementById("exit-modal").classList.add("hidden");
    });

    // Re-target button in target card
    document.getElementById("btn-retarget").addEventListener("click", () => {
      this.send({ type: "cmd", str: "*" });
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

    // Bottom action hotbar & D-Pad
    document.querySelectorAll("#hotbar [data-cmd]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        this.sound.ensureCtx();
        this.send({ type: "cmd", str: btn.dataset.cmd });
      });
    });
    document.querySelectorAll("#hotbar [data-key], #touch-dpad [data-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
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

  openExitModal(st) {
    const saveBtn = document.getElementById("btn-exit-save");
    const desc = document.getElementById("exit-modal-desc");
    if (st.canSave) {
      saveBtn.disabled = false;
      desc.textContent = "Save your current progress cleanly before returning to the lobby.";
    } else {
      saveBtn.disabled = true;
      desc.textContent = "You are inside a menu or prompt. Close it (Esc) to save, or Force Exit without saving.";
    }
    document.getElementById("exit-modal").classList.remove("hidden");
  }

  toggleControlMode() {
    const next = this.input.controlMode === "wasd" ? "classic" : "wasd";
    this.input.setControlMode(next);
    this.savePref("controlMode", next);
    this.syncControlModeUI();
    this.showToast(next === "wasd" ? "Controls: WASD Smart Mode" : "Controls: Classic Roguelike Mode");
  }

  syncControlModeUI() {
    const isWasd = this.input.controlMode === "wasd";
    document.getElementById("lbl-ctrl-mode").textContent = isWasd ? "WASD" : "Classic";
    document.getElementById("ctrl-mode-chip").textContent = isWasd ? "WASD" : "Classic";

    const ctrlList = document.getElementById("ctrl-list");
    ctrlList.innerHTML = isWasd
      ? `
        <li><strong>Left Click Map</strong> Walk / Attack / Auto-Travel</li>
        <li><strong>Right Click</strong> Look at Tile / Cancel Menu</li>
        <li><strong>Ctrl / Mid Click</strong> Lock Target Immediately</li>
        <li><strong>Shift + Click Self</strong> Rest Until Healed</li>
        <li><strong>WASD + QEZC</strong> 8-Way Move (Shift = Run)</li>
        <li><strong>X / Numpad</strong> Wait 1 Turn / Numpad Move</li>
        <li><strong>Scroll Wheel</strong> Smooth Zoom / Scroll Docs</li>
        <li><strong>F2</strong> Switch WASD ↔ Classic Keys</li>
      `
      : `
        <li><strong>Left Click Map</strong> Walk / Attack / Auto-Travel</li>
        <li><strong>Right Click</strong> Look at Tile / Cancel Menu</li>
        <li><strong>Ctrl / Mid Click</strong> Lock Target Immediately</li>
        <li><strong>Shift + Click Self</strong> Rest Until Healed</li>
        <li><strong>Numpad / Arrows</strong> 8-Way Move (Shift = Run)</li>
        <li><strong>Classic Keys</strong> . Wait, w Wear, q Quaff, r Read</li>
        <li><strong>Scroll Wheel</strong> Smooth Zoom / Scroll Docs</li>
        <li><strong>F2</strong> Switch Classic ↔ WASD Smart</li>
      `;
  }

  showToast(text) {
    const el = document.getElementById("toast-banner");
    el.textContent = text;
    el.classList.remove("hidden");
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.add("hidden"), 2400);
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
      this.renderSaveList(data);
    } catch {
      box.innerHTML = `<div class="empty-hint">Failed to query savefiles.</div>`;
    }
  }

  renderSaveList(data) {
    const box = document.getElementById("save-list");
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
      const row = document.createElement("div");
      row.className = "save-row";

      const btn = document.createElement("button");
      btn.className = "save-btn";
      const dt = new Date(s.mtime).toLocaleString();
      const kb = Math.max(1, Math.round(s.size / 1024));
      btn.innerHTML = `<strong>${this.escapeHtml(s.name)}</strong><small>${kb} KB · ${this.escapeHtml(dt)}</small>`;
      btn.addEventListener("click", () => this.startSession("load", s.name));

      const del = document.createElement("button");
      del.className = "save-del-btn";
      del.title = `Delete save "${s.name}"`;
      del.textContent = "🗑";
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete saved character "${s.name}"? This cannot be undone.`)) return;
        try {
          const res = await fetch("/api/saves/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: s.name }),
          });
          const out = await res.json();
          if (out.ok) {
            this.renderSaveList({ hasEngine: true, saves: out.saves });
          }
        } catch {
          /* ignore */
        }
      });

      row.appendChild(btn);
      row.appendChild(del);
      box.appendChild(row);
    }
  }

  resetHUD() {
    document.getElementById("top-pills").classList.add("hidden");
    document.getElementById("pill-depth").textContent = "Town";
    document.getElementById("pill-turn").textContent = "0";
    document.getElementById("pill-gold").textContent = "0 gp";
    const foodEl = document.getElementById("pill-food");
    foodEl.textContent = "Fed";
    foodEl.className = "pill-val";
    document.getElementById("hero-name").textContent = "Adventurer";
    document.getElementById("hero-sub").textContent = "Create or load a character";
    document.getElementById("hero-lv").textContent = "Lv 1";
    document.getElementById("hp-text").textContent = "0 / 0";
    document.getElementById("sp-text").textContent = "0 / 0";
    document.getElementById("xp-text").textContent = "0";
    document.getElementById("status-flags").innerHTML = "";
    document.getElementById("target-card").classList.add("hidden");
    document.getElementById("tab-radar").innerHTML = `<div class="empty-hint">No visible creatures nearby.</div>`;
    document.getElementById("tab-inven").innerHTML = `<div class="empty-hint">Pack is empty.</div>`;
    document.getElementById("tab-equip").innerHTML = `<div class="empty-hint">No gear equipped.</div>`;
    document.getElementById("msg-log").innerHTML = "";
    this._lastMsgsSig = "";
    this._logPinnedBottom = true;
    document.getElementById("btn-log-latest")?.classList.add("hidden");
  }

  startSession(mode, name) {
    this.sound.ensureCtx();
    const activeGraf = document.querySelector(".seg-btn.active[data-graf]")?.dataset.graf || "overhaul";
    this.resetHUD();
    document.getElementById("lobby-modal").classList.add("hidden");
    document.getElementById("exit-modal").classList.add("hidden");
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

  showLobby(sendStop = true) {
    if (sendStop) this.send({ type: "stop" });
    this.running = false;
    this.input.setEnabled(false);
    this.hideTooltip();
    this.resetHUD();
    document.getElementById("exit-modal").classList.add("hidden");
    document.getElementById("prompt-actions").classList.add("hidden");
    document.getElementById("workspace").classList.add("birth-wide");
    document.getElementById("conn-badge").textContent = this.connected ? "Ready" : "Disconnected";
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
        this.input.refreshHover();
        break;
      case "hover":
        this.updateTooltip(msg);
        break;
      case "save_blocked":
        this.showToast(msg.msg || "Finish current prompt before saving.");
        break;
      case "error":
        alert(msg.msg || "Engine error");
        this.showLobby(false);
        break;
      case "quit":
      case "exit":
        if (this.running) this.showLobby(false);
        break;
    }
  }

  syncHUD(st) {
    // Wide layout during character creation (!st.gen)
    const ws = document.getElementById("workspace");
    ws.classList.toggle("birth-wide", !st.gen);
    document.getElementById("top-pills").classList.toggle("hidden", !st.gen);

    // Graphics active pill sync
    if (st.graf) {
      const target = st.graf === "ascii" ? "none" : st.graf;
      document.querySelectorAll(".seg-btn[data-graf]").forEach((b) => {
        b.classList.toggle("active", b.dataset.graf === target);
      });
    }

    // Context badge
    const ctxBadge = document.getElementById("ctx-badge");
    if (!st.dungeon || st.icky) {
      ctxBadge.textContent = CTX_LABELS[st.ctx] || "Menu";
    } else if (!st.cmdReady) {
      ctxBadge.textContent = st.ctx === 2 ? "Targeting" : "Prompt";
    } else {
      ctxBadge.textContent = "Exploring";
    }

    // Hotbar availability (disable gameplay command buttons when inside menus/prompts)
    const canRunCmd = !!(st.gen && st.dungeon && !st.icky && st.cmdReady);
    document.querySelectorAll("#hotbar .hb-btn").forEach((btn) => {
      if (btn.dataset.key === "19") {
        btn.disabled = !st.canSave;
      } else {
        btn.disabled = !canRunCmd;
      }
    });

    // Context-smart floating prompt actions
    this.syncPromptBar(st);

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

      this.syncFoodPill(p.food);

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

    const mons = st.mons || [];
    const inven = st.inven || [];
    const equip = st.equip || [];

    document.getElementById("tab-btn-radar").textContent = mons.length ? `Nearby (${mons.length})` : "Nearby";
    document.getElementById("tab-btn-inven").textContent = inven.length ? `Pack (${inven.length})` : "Pack";
    const eqCount = equip.filter((e) => !e.empty).length;
    document.getElementById("tab-btn-equip").textContent = eqCount ? `Gear (${eqCount})` : "Gear";

    this.syncRadar(mons, canRunCmd);
    this.syncInven(inven, canRunCmd);
    this.syncEquip(equip, canRunCmd);
    this.syncMessages(st.msgs || []);
  }

  syncFoodPill(food) {
    const el = document.getElementById("pill-food");
    let label = "Fed";
    let cls = "";
    if (food < 500) { label = "Faint!"; cls = "bad"; }
    else if (food < 1000) { label = "Weak"; cls = "bad"; }
    else if (food < 2000) { label = "Hungry"; cls = "warn"; }
    else if (food >= 15000) { label = "Gorged"; cls = "warn"; }
    else if (food >= 10000) { label = "Full"; cls = "good"; }
    el.textContent = label;
    el.className = `pill-val ${cls}`.trim();
  }

  syncPromptBar(st) {
    const bar = document.getElementById("prompt-actions");
    const kind = st.promptKind || (st.cmdReady ? "none" : "prompt");
    if (st.gen && st.dungeon && !st.icky && st.cmdReady && kind === "none") {
      bar.classList.add("hidden");
      this._lastPromptSig = "";
      return;
    }

    const sig = `${kind}:${st.ctx}:${st.gen ? 1 : 0}:${st.promptText || ""}`;
    if (sig === this._lastPromptSig && !bar.classList.contains("hidden")) return;
    this._lastPromptSig = sig;

    bar.innerHTML = "";
    const addPill = (label, action, cls = "") => {
      const b = document.createElement("button");
      b.className = `prompt-pill ${cls}`.trim();
      b.textContent = label;
      b.addEventListener("click", () => {
        this.sound.ensureCtx();
        action();
      });
      bar.appendChild(b);
    };

    if (kind === "birth" || !st.gen) {
      const lbl = document.createElement("span");
      lbl.className = "prompt-label";
      lbl.textContent = "Character Creation · Click option or use keys";
      bar.appendChild(lbl);
      addPill("Enter · Confirm", () => this.send({ type: "key", code: 13 }));
      addPill("Esc · Back", () => this.send({ type: "key", code: 27 }), "ghost");
      addPill("= · Options", () => this.send({ type: "key", code: "=".charCodeAt(0) }), "ghost");
      addPill("? · Help", () => this.send({ type: "key", code: "?".charCodeAt(0) }), "ghost");
    } else if (kind === "more") {
      addPill("Space · Continue", () => this.send({ type: "key", code: 32 }), "warn");
      addPill("Esc · Dismiss", () => this.send({ type: "key", code: 27 }), "ghost");
    } else if (kind === "yn") {
      if (st.promptText) {
        const lbl = document.createElement("span");
        lbl.className = "prompt-label";
        lbl.textContent = st.promptText;
        bar.appendChild(lbl);
      }
      addPill("Y · Yes", () => this.send({ type: "key", code: "y".charCodeAt(0) }));
      addPill("N · No", () => this.send({ type: "key", code: "n".charCodeAt(0) }), "danger");
      addPill("Esc · Cancel", () => this.send({ type: "key", code: 27 }), "ghost");
    } else if (kind === "dir") {
      const lbl = document.createElement("span");
      lbl.className = "prompt-label";
      lbl.textContent = "Pick direction (click map, WASD/numpad, or):";
      bar.appendChild(lbl);
      const pad = document.createElement("span");
      pad.className = "dir-mini-pad";
      for (const [d, sym] of [["7", "↖"], ["8", "↑"], ["9", "↗"], ["4", "←"], ["6", "→"], ["1", "↙"], ["2", "↓"], ["3", "↘"]]) {
        const db = document.createElement("button");
        db.textContent = sym;
        db.addEventListener("click", () => this.send({ type: "key", code: d.charCodeAt(0) }));
        pad.appendChild(db);
      }
      bar.appendChild(pad);
      addPill("Esc · Cancel", () => this.send({ type: "key", code: 27 }), "ghost");
    } else if (kind === "target") {
      const lbl = document.createElement("span");
      lbl.className = "prompt-label";
      lbl.textContent = "Click tile to target/inspect";
      bar.appendChild(lbl);
      addPill("Space · Next", () => this.send({ type: "key", code: 32 }));
      addPill("t · Lock Target", () => this.send({ type: "key", code: "t".charCodeAt(0) }), "warn");
      addPill("Esc · Cancel", () => this.send({ type: "key", code: 27 }), "ghost");
    } else if (kind === "menu") {
      addPill("PgUp", () => this.send({ type: "skey", name: "[page_up]", shift: 0, ctrl: 0 }), "ghost");
      addPill("PgDn", () => this.send({ type: "skey", name: "[page_down]", shift: 0, ctrl: 0 }), "ghost");
      addPill("? · Help", () => this.send({ type: "key", code: "?".charCodeAt(0) }), "ghost");
      addPill("Esc · Close", () => this.send({ type: "key", code: 27 }), "warn");
    } else {
      if (st.promptText) {
        const lbl = document.createElement("span");
        lbl.className = "prompt-label";
        lbl.textContent = st.promptText;
        bar.appendChild(lbl);
      }
      addPill("Enter · Confirm", () => this.send({ type: "key", code: 13 }));
      addPill("Esc · Cancel", () => this.send({ type: "key", code: 27 }), "ghost");
    }

    bar.classList.remove("hidden");
  }

  formatStat(val) {
    if (val <= 18) return String(val);
    return `18/${String(val - 18).padStart(2, "0")}`;
  }

  syncRadar(mons, canRunCmd) {
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
        <div class="item-actions">
          <button class="mini-btn" data-act="look" ${canRunCmd ? "" : "disabled"}>👁 Look</button>
          <button class="mini-btn" data-act="target" ${canRunCmd ? "" : "disabled"}>🎯 Target</button>
        </div>
      `;
      item.querySelector('[data-act="look"]').addEventListener("click", (e) => {
        e.stopPropagation();
        this.send({ type: "mouse", x: ux, y: uy, btn: 2, mods: 0 });
      });
      item.querySelector('[data-act="target"]').addEventListener("click", (e) => {
        e.stopPropagation();
        this.send({ type: "mouse", x: ux, y: uy, btn: 1, mods: 2 });
      });
      item.addEventListener("click", (e) => {
        if (!canRunCmd) return;
        this.send({ type: "mouse", x: ux, y: uy, btn: e.ctrlKey ? 1 : 2, mods: e.ctrlKey ? 2 : 0 });
      });
      box.appendChild(item);
    }
  }

  syncInven(items, canRunCmd) {
    const box = document.getElementById("tab-inven");
    if (!items.length) {
      box.innerHTML = `<div class="empty-hint">Pack is empty.</div>`;
      return;
    }
    box.innerHTML = "";
    for (const it of items) {
      const div = document.createElement("div");
      div.className = "list-item";
      const qa = quickActionForTval(it.tval);
      div.innerHTML = `
        <div class="list-item-row">
          <span class="item-name"><span class="slot-tag">${it.lbl})</span>${this.escapeHtml(it.name)}</span>
          <small style="color:var(--muted)">${(it.wgt / 10).toFixed(1)}lb</small>
        </div>
        <div class="item-actions">
          <button class="mini-btn" data-act="inspect" ${canRunCmd ? "" : "disabled"}>Inspect</button>
          ${qa ? `<button class="mini-btn" data-act="use" ${canRunCmd ? "" : "disabled"}>${qa.label}</button>` : ""}
          <button class="mini-btn danger" data-act="drop" ${canRunCmd ? "" : "disabled"}>Drop</button>
        </div>
      `;
      div.querySelector('[data-act="inspect"]').addEventListener("click", (e) => {
        e.stopPropagation();
        if (canRunCmd) this.send({ type: "cmd", str: "I" + it.lbl });
      });
      if (qa) {
        div.querySelector('[data-act="use"]').addEventListener("click", (e) => {
          e.stopPropagation();
          if (canRunCmd) this.send({ type: "cmd", str: qa.cmd });
        });
      }
      div.querySelector('[data-act="drop"]').addEventListener("click", (e) => {
        e.stopPropagation();
        if (canRunCmd) this.send({ type: "cmd", str: "d" + it.lbl });
      });
      div.addEventListener("click", () => {
        if (canRunCmd) this.send({ type: "cmd", str: "I" + it.lbl });
      });
      box.appendChild(div);
    }
  }

  syncEquip(items, canRunCmd) {
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
        ${
          eq.empty
            ? ""
            : `<div class="item-actions">
                <button class="mini-btn" data-act="gear" ${canRunCmd ? "" : "disabled"}>Inspect</button>
                <button class="mini-btn" data-act="act" ${canRunCmd ? "" : "disabled"}>Activate</button>
                <button class="mini-btn danger" data-act="off" ${canRunCmd ? "" : "disabled"}>Remove</button>
              </div>`
        }
      `;
      if (!eq.empty) {
        div.querySelector('[data-act="gear"]').addEventListener("click", (e) => {
          e.stopPropagation();
          if (canRunCmd) this.send({ type: "cmd", str: "e" });
        });
        div.querySelector('[data-act="act"]').addEventListener("click", (e) => {
          e.stopPropagation();
          if (canRunCmd) this.send({ type: "cmd", str: "A" });
        });
        div.querySelector('[data-act="off"]').addEventListener("click", (e) => {
          e.stopPropagation();
          if (canRunCmd) this.send({ type: "cmd", str: "t" + eq.lbl });
        });
        div.addEventListener("click", () => {
          if (canRunCmd) this.send({ type: "cmd", str: "e" });
        });
      }
      box.appendChild(div);
    }
  }

  syncMessages(msgs) {
    const box = document.getElementById("msg-log");
    const latestBtn = document.getElementById("btn-log-latest");
    const sig = msgs.map((m) => `${m.t}:${m.n}:${m.c}:${m.s}`).join("\n");

    if (sig === this._lastMsgsSig) {
      if (this._logPinnedBottom && box.clientHeight > 0 && box.scrollHeight - box.scrollTop - box.clientHeight > 2) {
        this._updatingMsgs = true;
        box.scrollTop = box.scrollHeight;
        requestAnimationFrame(() => {
          this._updatingMsgs = false;
        });
      }
      return;
    }

    this._lastMsgsSig = sig;
    const prevScrollTop = box.scrollTop;
    this._updatingMsgs = true;
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

    if (this._logPinnedBottom) {
      box.scrollTop = box.scrollHeight;
      if (latestBtn) latestBtn.classList.add("hidden");
      requestAnimationFrame(() => {
        if (this._logPinnedBottom) {
          box.scrollTop = box.scrollHeight;
        }
        this._updatingMsgs = false;
      });
    } else {
      box.scrollTop = prevScrollTop;
      if (latestBtn) latestBtn.classList.remove("hidden");
      requestAnimationFrame(() => {
        this._updatingMsgs = false;
      });
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

    const metaEl = document.getElementById("ht-meta");
    if (typeof msg.rng === "number") {
      const losText = msg.proj
        ? "In Line of Fire"
        : msg.los
        ? "In Sight (Path Blocked)"
        : "Out of Sight";
      metaEl.textContent = msg.rng > 0 ? `Dist ${msg.rng} · ${losText}` : "Your Position (Dist 0)";
      metaEl.classList.remove("hidden");
    } else {
      metaEl.classList.add("hidden");
    }

    const barWrap = document.getElementById("ht-bar-wrap");
    const barFill = document.getElementById("ht-bar-fill");
    if (typeof msg.hp === "number" && msg.hp >= 0) {
      barWrap.classList.remove("hidden");
      barFill.style.width = `${Math.max(0, Math.min(100, msg.hp))}%`;
      barFill.style.background = msg.att === 2 ? "#4ade80" : msg.att === 1 ? "#38bdf8" : "#ef4444";
    } else {
      barWrap.classList.add("hidden");
    }

    const badgesEl = document.getElementById("ht-badges");
    badgesEl.innerHTML = "";
    if (Array.isArray(msg.badges) && msg.badges.length > 0) {
      for (const b of msg.badges) {
        const span = document.createElement("span");
        span.className = `ht-badge ${b.kind || "neutral"}`;
        span.textContent = b.label || "";
        badgesEl.appendChild(span);
      }
      badgesEl.classList.remove("hidden");
    } else {
      badgesEl.classList.add("hidden");
    }

    const detailsEl = document.getElementById("ht-details");
    detailsEl.innerHTML = "";
    if (Array.isArray(msg.details) && msg.details.length > 0) {
      for (const line of msg.details) {
        const div = document.createElement("div");
        div.className = "ht-detail-line";
        div.textContent = line;
        detailsEl.appendChild(div);
      }
      detailsEl.classList.remove("hidden");
    } else {
      detailsEl.classList.add("hidden");
    }

    tt.classList.remove("hidden");
    this.positionTooltip(tt);
  }

  positionTooltip(tt) {
    const stageRect = this.stage.getBoundingClientRect();
    const ttW = tt.offsetWidth || 260;
    const ttH = tt.offsetHeight || 120;
    let x = this.lastMousePos.x + 16;
    let y = this.lastMousePos.y + 16;
    if (x + ttW + 8 > stageRect.width) x = Math.max(8, this.lastMousePos.x - ttW - 14);
    if (y + ttH + 8 > stageRect.height) y = Math.max(8, this.lastMousePos.y - ttH - 14);
    tt.style.left = `${x}px`;
    tt.style.top = `${y}px`;
  }

  hideTooltip() {
    document.getElementById("hover-tooltip").classList.add("hidden");
  }

  startRenderLoop() {
    let prev = performance.now();
    const tick = (now) => {
      requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      try {
        this.renderer.render(now, dt);
      } catch (err) {
        console.error("Render error:", err);
      }
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
