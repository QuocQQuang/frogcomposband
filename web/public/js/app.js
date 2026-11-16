import { SoundEngine } from "./audio.js";
import { GameRenderer } from "./renderer.js";
import { InputController } from "./input.js";
import { ICONS, iconHtml } from "./icons.js";
import { startTitleDiorama } from "./titleArt.js";

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
    this._stopTitleArt = null;
    this._voluntaryExit = false;
    this._lastRunSnapshot = null;

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

    this.injectStaticIcons();
    this.applySavedPrefs();
    this.bindUI();
    this.syncControlModeUI();
    this.connectWebSocket();
    this.refreshSaves();
    this.startTitleArt();
    this.startRenderLoop();
  }

  injectStaticIcons() {
    document.querySelectorAll("[data-icon]").forEach((el) => {
      const name = el.dataset.icon;
      if (ICONS[name]) el.innerHTML = ICONS[name];
    });
  }

  startTitleArt() {
    if (this._stopTitleArt) return;
    const c = document.getElementById("title-diorama");
    if (c) this._stopTitleArt = startTitleDiorama(c);
  }

  stopTitleArt() {
    if (this._stopTitleArt) {
      this._stopTitleArt();
      this._stopTitleArt = null;
    }
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
      this.syncToggleButton("btn-fx", this.renderer.fxEnabled, "Enabled", "Disabled");
    }
    if (typeof this.prefs.soundVolume === "number") {
      this.sound.setVolume(this.prefs.soundVolume);
    }
    const volRange = document.getElementById("rng-volume");
    if (volRange) {
      volRange.value = String(Math.round(this.sound.volume * 100));
    }
    if (typeof this.prefs.soundEnabled === "boolean") {
      this.sound.setEnabled(this.prefs.soundEnabled);
    }
    this.syncSoundUI();

    if (this.prefs.dpadVisible) {
      document.getElementById("touch-dpad").classList.remove("hidden");
      this.syncToggleButton("btn-dpad", true, "Visible", "Hidden");
    }
    if (this.prefs.sidebarsVisible === false) {
      document.getElementById("workspace").classList.add("no-sidebars");
      document.getElementById("btn-sidebar").classList.remove("active");
    }
  }

  syncToggleButton(id, active, onText, offText) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("active", active);
    el.textContent = active ? onText : offText;
  }

  syncSoundUI() {
    const on = this.sound.enabled;
    const tbBtn = document.getElementById("btn-sound");
    if (tbBtn) {
      tbBtn.classList.toggle("active", on);
      tbBtn.innerHTML = iconHtml(on ? "soundOn" : "soundOff");
    }
    this.syncToggleButton("btn-sound-settings", on, "On", "Muted");
  }

  hasAnyModalOpen() {
    return (
      !document.getElementById("exit-modal").classList.contains("hidden") ||
      !document.getElementById("settings-modal").classList.contains("hidden") ||
      !document.getElementById("controls-modal").classList.contains("hidden") ||
      !document.getElementById("endgame-modal").classList.contains("hidden")
    );
  }

  syncModalPauseState() {
    this.input.setPaused(this.hasAnyModalOpen());
  }

  closeDrawers() {
    document.body.classList.remove("drawer-hero", "drawer-log");
    document.getElementById("drawer-backdrop").classList.add("hidden");
  }

  toggleDrawer(which) {
    const cls = which === "hero" ? "drawer-hero" : "drawer-log";
    const other = which === "hero" ? "drawer-log" : "drawer-hero";
    document.body.classList.remove(other);
    const opening = !document.body.classList.contains(cls);
    document.body.classList.toggle(cls, opening);
    document.getElementById("drawer-backdrop").classList.toggle("hidden", !opening);
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

    // Global Escape handler for UI modals & mobile drawers
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape") return;

        const settingsEl = document.getElementById("settings-modal");
        if (!settingsEl.classList.contains("hidden")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          settingsEl.classList.add("hidden");
          this.syncModalPauseState();
          return;
        }

        const ctrlEl = document.getElementById("controls-modal");
        if (!ctrlEl.classList.contains("hidden")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          ctrlEl.classList.add("hidden");
          this.syncModalPauseState();
          return;
        }

        const exitEl = document.getElementById("exit-modal");
        if (!exitEl.classList.contains("hidden")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.closePauseModal();
          return;
        }

        const endEl = document.getElementById("endgame-modal");
        if (!endEl.classList.contains("hidden")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          endEl.classList.add("hidden");
          this.syncModalPauseState();
          return;
        }

        if (document.body.classList.contains("drawer-hero") || document.body.classList.contains("drawer-log")) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.closeDrawers();
          return;
        }

        // In normal dungeon command mode (not inside menu/prompt/targeting), Esc opens Game Menu
        const st = this.renderer.state || {};
        if (
          this.running &&
          st.gen &&
          st.dungeon &&
          !st.icky &&
          st.cmdReady &&
          !st.busy &&
          (!st.promptKind || st.promptKind === "none")
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.openExitModal(st);
        }
      },
      true
    );

    // Chronicle scroll pinning
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

    // Control mode toggles (topbar + settings)
    document.getElementById("btn-ctrl-mode").addEventListener("click", () => this.toggleControlMode());
    document.getElementById("set-ctrl-wasd").addEventListener("click", () => this.setControlMode("wasd"));
    document.getElementById("set-ctrl-classic").addEventListener("click", () => this.setControlMode("classic"));

    // FX toggle
    document.getElementById("btn-fx").addEventListener("click", () => {
      this.renderer.fxEnabled = !this.renderer.fxEnabled;
      this.syncToggleButton("btn-fx", this.renderer.fxEnabled, "Enabled", "Disabled");
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

    // Sound toggle & volume
    const toggleSound = () => {
      const next = !this.sound.enabled;
      this.sound.setEnabled(next);
      this.syncSoundUI();
      this.savePref("soundEnabled", next);
    };
    document.getElementById("btn-sound").addEventListener("click", toggleSound);
    document.getElementById("btn-sound-settings").addEventListener("click", toggleSound);
    document.getElementById("rng-volume").addEventListener("input", (e) => {
      const v = Number(e.target.value) / 100;
      this.sound.setVolume(v);
      this.savePref("soundVolume", v);
    });

    // On-screen D-Pad toggle
    document.getElementById("btn-dpad").addEventListener("click", () => {
      const dpad = document.getElementById("touch-dpad");
      const hidden = dpad.classList.toggle("hidden");
      this.syncToggleButton("btn-dpad", !hidden, "Visible", "Hidden");
      this.savePref("dpadVisible", !hidden);
    });

    // Desktop Sidebar toggle
    const sbBtn = document.getElementById("btn-sidebar");
    const wsEl = document.getElementById("workspace");
    sbBtn.addEventListener("click", () => {
      const hidden = wsEl.classList.toggle("no-sidebars");
      sbBtn.classList.toggle("active", !hidden);
      this.savePref("sidebarsVisible", !hidden);
    });

    // Mobile Drawers
    document.getElementById("btn-drawer-hero").addEventListener("click", () => this.toggleDrawer("hero"));
    document.getElementById("btn-drawer-log").addEventListener("click", () => this.toggleDrawer("log"));
    document.getElementById("drawer-backdrop").addEventListener("click", () => this.closeDrawers());
    document.querySelectorAll("[data-close-drawer]").forEach((b) => {
      b.addEventListener("click", () => this.closeDrawers());
    });

    // Settings Modal triggers
    const openSettings = () => {
      document.getElementById("settings-modal").classList.remove("hidden");
      this.syncModalPauseState();
    };
    document.getElementById("btn-settings").addEventListener("click", openSettings);
    document.getElementById("btn-title-settings").addEventListener("click", openSettings);
    document.getElementById("btn-pause-settings").addEventListener("click", () => {
      this.closePauseModal();
      openSettings();
    });
    document.getElementById("btn-settings-close").addEventListener("click", () => {
      document.getElementById("settings-modal").classList.add("hidden");
      this.syncModalPauseState();
    });

    // Controls Reference Modal triggers
    const openControls = () => {
      document.getElementById("controls-modal").classList.remove("hidden");
      this.syncModalPauseState();
    };
    document.getElementById("btn-controls-ref").addEventListener("click", openControls);
    document.getElementById("btn-title-controls").addEventListener("click", openControls);
    document.getElementById("btn-pause-controls").addEventListener("click", () => {
      this.closePauseModal();
      openControls();
    });
    document.getElementById("btn-controls-close").addEventListener("click", () => {
      document.getElementById("controls-modal").classList.add("hidden");
      this.syncModalPauseState();
    });

    // Game Menu / Pause button
    document.getElementById("btn-lobby").addEventListener("click", () => {
      if (this.running) {
        this.openExitModal(this.renderer.state || {});
      } else {
        this.showLobby(true);
      }
    });

    // Pause / Exit confirmation modal buttons
    document.getElementById("btn-pause-resume").addEventListener("click", () => this.closePauseModal());
    document.getElementById("btn-exit-cancel").addEventListener("click", () => this.closePauseModal());
    document.getElementById("btn-exit-save").addEventListener("click", () => {
      this._voluntaryExit = true;
      this.closePauseModal();
      this.send({ type: "save_quit" });
    });
    document.getElementById("btn-exit-discard").addEventListener("click", () => {
      document.getElementById("abandon-confirm").classList.remove("hidden");
    });
    document.getElementById("btn-abandon-no").addEventListener("click", () => {
      document.getElementById("abandon-confirm").classList.add("hidden");
    });
    document.getElementById("btn-abandon-yes").addEventListener("click", () => {
      this._voluntaryExit = true;
      this.closePauseModal();
      this.showLobby(true);
    });

    // Endgame Modal buttons
    document.getElementById("btn-endgame-title").addEventListener("click", () => {
      document.getElementById("endgame-modal").classList.add("hidden");
      this.syncModalPauseState();
      this.showLobby(false);
    });
    document.getElementById("btn-endgame-new").addEventListener("click", () => {
      document.getElementById("endgame-modal").classList.add("hidden");
      this.syncModalPauseState();
      this.showLobby(false);
      document.getElementById("new-hero-name").focus();
    });

    // Re-target button in target card
    document.getElementById("btn-retarget").addEventListener("click", () => {
      this.send({ type: "cmd", str: "*" });
    });

    // Title screen start new hero
    const startNew = () => {
      const nameInput = document.getElementById("new-hero-name");
      const name = (nameInput.value || "PLAYER").trim();
      this.startSession("new", name);
    };
    document.getElementById("btn-start-new").addEventListener("click", startNew);
    document.getElementById("new-hero-name").addEventListener("keydown", (e) => {
      if (e.key === "Enter") startNew();
    });

    // Left drawer tabs (Nearby / Pack / Gear)
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

    // Action Dock Category Tabs (Explore / Items / Ledger)
    document.querySelectorAll(".dock-tab[data-dock-group]").forEach((tab) => {
      tab.addEventListener("click", () => {
        const grp = tab.dataset.dockGroup;
        document.querySelectorAll(".dock-tab[data-dock-group]").forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        document.querySelectorAll("#hotbar .hb-btn[data-group]").forEach((btn) => {
          btn.classList.toggle("hidden-group", btn.dataset.group !== grp);
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

  closePauseModal() {
    document.getElementById("exit-modal").classList.add("hidden");
    document.getElementById("abandon-confirm").classList.add("hidden");
    this.syncModalPauseState();
  }

  openExitModal(st) {
    const saveBtn = document.getElementById("btn-exit-save");
    const desc = document.getElementById("exit-modal-desc");
    document.getElementById("abandon-confirm").classList.add("hidden");
    if (!st.gen || !st.dungeon) {
      saveBtn.disabled = true;
      desc.textContent = "Character creation is in progress. Abandoning returns to the title screen.";
    } else if (st.canSave) {
      saveBtn.disabled = false;
      desc.textContent = "Save your expedition safely before returning to the title screen.";
    } else {
      saveBtn.disabled = true;
      desc.textContent = "Finish or cancel (Esc) the current menu or prompt before saving.";
    }
    document.getElementById("exit-modal").classList.remove("hidden");
    this.syncModalPauseState();
  }

  setControlMode(mode) {
    this.input.setControlMode(mode);
    this.savePref("controlMode", this.input.controlMode);
    this.syncControlModeUI();
  }

  toggleControlMode() {
    const next = this.input.controlMode === "wasd" ? "classic" : "wasd";
    this.setControlMode(next);
    this.showToast(next === "wasd" ? "Controls: WASD Smart Mode" : "Controls: Classic Roguelike Mode");
  }

  syncControlModeUI() {
    const isWasd = this.input.controlMode === "wasd";
    document.getElementById("lbl-ctrl-mode").textContent = isWasd ? "WASD" : "Classic";
    document.getElementById("ctrl-mode-chip").textContent = isWasd ? "WASD" : "Classic";
    document.getElementById("set-ctrl-wasd")?.classList.toggle("active", isWasd);
    document.getElementById("set-ctrl-classic")?.classList.toggle("active", !isWasd);

    const ctrlList = document.getElementById("ctrl-list");
    ctrlList.innerHTML = isWasd
      ? `
        <li><strong>WASD + QEZC</strong> 8-Way Move (Shift = Run)</li>
        <li><strong>X / Numpad</strong> Wait 1 Turn / Numpad Move</li>
        <li><strong>F2</strong> Switch WASD ↔ Classic Keys</li>
        <li><strong>, / R / s</strong> Wait, Rest, Search</li>
        <li><strong>o / c / D</strong> Open, Close, Disarm</li>
        <li><strong>g / d / w</strong> Get, Drop, Wear/Wield</li>
        <li><strong>q / r / E</strong> Quaff, Read, Eat</li>
        <li><strong>m / f / U</strong> Cast, Fire, Power</li>
      `
      : `
        <li><strong>Numpad / Arrows</strong> 8-Way Move (Shift = Run)</li>
        <li><strong>h j k l y u b n</strong> Classic Vi 8-Way Move</li>
        <li><strong>F2</strong> Switch Classic ↔ WASD Smart</li>
        <li><strong>. / R / s</strong> Wait, Rest, Search</li>
        <li><strong>o / c / D</strong> Open, Close, Disarm</li>
        <li><strong>g / d / w</strong> Get, Drop, Wear/Wield</li>
        <li><strong>q / r / E</strong> Quaff, Read, Eat</li>
        <li><strong>m / f / U</strong> Cast, Fire, Power</li>
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
      const tStatus = document.getElementById("title-conn-status");
      if (tStatus) {
        tStatus.textContent = "Engine ready";
        tStatus.classList.remove("offline");
      }
    };

    ws.onclose = () => {
      this.connected = false;
      this.running = false;
      this.input.setEnabled(false);
      document.getElementById("conn-badge").textContent = "Reconnecting...";
      const tStatus = document.getElementById("title-conn-status");
      if (tStatus) {
        tStatus.textContent = "Connection lost — retrying...";
        tStatus.classList.add("offline");
      }
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
      box.innerHTML = `<div class="empty-hint">No saved expeditions found. Start a new hero above.</div>`;
      return;
    }
    box.innerHTML = "";
    for (const s of data.saves) {
      const row = document.createElement("div");
      row.className = "save-row";

      const main = document.createElement("div");
      main.className = "save-row-main";

      const btn = document.createElement("button");
      btn.className = "save-btn";
      const dt = new Date(s.mtime).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const kb = Math.max(1, Math.round(s.size / 1024));
      btn.innerHTML = `<strong>${this.escapeHtml(s.name)}</strong><small class="num">${kb} KB · ${this.escapeHtml(dt)}</small>`;
      btn.addEventListener("click", () => this.startSession("load", s.name));

      const del = document.createElement("button");
      del.className = "save-del-btn";
      del.title = `Delete save "${s.name}"`;
      del.setAttribute("aria-label", `Delete save ${s.name}`);
      del.innerHTML = iconHtml("trash");

      const confirmBar = document.createElement("div");
      confirmBar.className = "confirm-bar hidden";
      confirmBar.innerHTML = `
        <span>Delete <strong>${this.escapeHtml(s.name)}</strong>?</span>
        <div style="display:flex;gap:5px">
          <button type="button" class="danger-btn" data-yes>Delete</button>
          <button type="button" class="ghost-btn" data-no>Cancel</button>
        </div>
      `;

      del.addEventListener("click", (e) => {
        e.stopPropagation();
        confirmBar.classList.toggle("hidden");
      });
      confirmBar.querySelector("[data-no]").addEventListener("click", () => {
        confirmBar.classList.add("hidden");
      });
      confirmBar.querySelector("[data-yes]").addEventListener("click", async () => {
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

      main.appendChild(btn);
      main.appendChild(del);
      row.appendChild(main);
      row.appendChild(confirmBar);
      box.appendChild(row);
    }
  }

  resetHUD() {
    document.getElementById("top-pills").classList.add("hidden");
    document.getElementById("mobile-vitals").classList.add("hidden");
    document.getElementById("pill-depth").textContent = "Town";
    document.getElementById("pill-turn").textContent = "0";
    document.getElementById("pill-gold").textContent = "0 gp";
    const foodEl = document.getElementById("pill-food");
    foodEl.textContent = "Fed";
    foodEl.className = "telem-val";
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
    this.stopTitleArt();
    this._voluntaryExit = false;
    this._lastRunSnapshot = null;
    document.getElementById("lobby-modal").classList.add("hidden");
    this.closePauseModal();
    this.closeDrawers();
    document.getElementById("conn-badge").textContent = name;
    this.running = true;
    this.input.setEnabled(true);
    this.syncModalPauseState();
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
    if (sendStop) {
      this._voluntaryExit = true;
      this.send({ type: "stop" });
    }
    this.running = false;
    this.input.setEnabled(false);
    this.closeDrawers();
    this.closePauseModal();
    this.hideTooltip();
    this.resetHUD();
    document.getElementById("prompt-actions").classList.add("hidden");
    document.getElementById("workspace").classList.add("birth-wide");
    document.getElementById("conn-badge").textContent = this.connected ? "Ready" : "Disconnected";
    document.getElementById("lobby-modal").classList.remove("hidden");
    this.startTitleArt();
    this.refreshSaves();
  }

  maybeShowEndgame() {
    const snap = this._lastRunSnapshot;
    if (!snap || !snap.gen || !snap.player || this._voluntaryExit) {
      this.showLobby(false);
      return;
    }

    const p = snap.player;
    const msgJoined = (snap.msgs || []).map((m) => m.s || "").join(" ").toLowerCase();
    const isWinner =
      msgJoined.includes("total winner") ||
      msgJoined.includes("you have slain the serpent") ||
      msgJoined.includes("ripe old age");
    const isDead = p.chp < 0 || msgJoined.includes("you die") || msgJoined.includes("killed by");

    if (!isWinner && !isDead) {
      this.showLobby(false);
      this.showToast("Expedition saved.");
      return;
    }

    this.running = false;
    this.input.setEnabled(false);
    this.hideTooltip();
    this.closeDrawers();

    const crest = document.getElementById("endgame-crest");
    const kicker = document.getElementById("endgame-kicker");
    const title = document.getElementById("endgame-title");
    const sub = document.getElementById("endgame-sub");

    crest.className = `endgame-crest ${isWinner ? "" : "death"}`.trim();
    crest.innerHTML = iconHtml(isWinner ? "crown" : "skull");
    kicker.textContent = isWinner ? "Victory Achieved" : "Epitaph";
    title.textContent = isWinner ? "Champion of Chaos" : "Fallen in the Depths";
    sub.textContent = `${p.name} — Lv ${p.lev} ${p.pers} ${p.race} ${p.class}`;

    const loc = p.wild ? "Wilderness" : p.depth > 0 ? `${p.depth * 50} ft` : "Town";
    document.getElementById("endgame-stats").innerHTML = `
      <div class="eg-stat"><span>Level</span><strong>${p.lev}</strong></div>
      <div class="eg-stat"><span>Location</span><strong>${this.escapeHtml(loc)}</strong></div>
      <div class="eg-stat"><span>Turns</span><strong>${p.turn.toLocaleString()}</strong></div>
      <div class="eg-stat"><span>Gold</span><strong>${p.au.toLocaleString()}</strong></div>
    `;

    const chron = document.getElementById("endgame-chronicle");
    const tail = (snap.msgs || []).slice(-6);
    chron.innerHTML = tail.length
      ? tail.map((m) => `<div>${this.escapeHtml(m.s)}</div>`).join("")
      : "<div>No final chronicle recorded.</div>";

    document.getElementById("endgame-modal").classList.remove("hidden");
    this.syncModalPauseState();
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
        if (msg.state) {
          if (msg.state.gen && msg.state.player) {
            this._lastRunSnapshot = {
              gen: msg.state.gen,
              player: msg.state.player,
              msgs: msg.state.msgs || [],
            };
          }
          this.syncHUD(msg.state);
        }
        this.input.refreshHover();
        break;
      case "hover":
        this.updateTooltip(msg);
        break;
      case "save_blocked":
        this._voluntaryExit = false;
        this.showToast(msg.msg || "Finish current prompt before saving.");
        break;
      case "error":
        this.showToast(msg.msg || "Engine error");
        this.showLobby(false);
        break;
      case "quit":
      case "exit":
        if (this.running) this.maybeShowEndgame();
        break;
    }
  }

  syncHUD(st) {
    const ws = document.getElementById("workspace");
    ws.classList.toggle("birth-wide", !st.gen);
    document.getElementById("top-pills").classList.toggle("hidden", !st.gen);
    document.getElementById("mobile-vitals").classList.toggle("hidden", !st.gen);

    if (st.graf) {
      const target = st.graf === "ascii" ? "none" : st.graf;
      document.querySelectorAll(".seg-btn[data-graf]").forEach((b) => {
        b.classList.toggle("active", b.dataset.graf === target);
      });
    }

    const ctxBadge = document.getElementById("ctx-badge");
    if (!st.dungeon || st.icky) {
      ctxBadge.textContent = CTX_LABELS[st.ctx] || "Menu";
    } else if (!st.cmdReady) {
      ctxBadge.textContent = st.ctx === 2 ? "Targeting" : "Prompt";
    } else {
      ctxBadge.textContent = "Exploring";
    }

    const canRunCmd = !!(st.gen && st.dungeon && !st.icky && st.cmdReady);
    document.querySelectorAll("#hotbar .hb-btn").forEach((btn) => {
      if (btn.dataset.key === "19") {
        btn.disabled = !st.canSave;
      } else {
        btn.disabled = !canRunCmd;
      }
    });

    this.syncPromptBar(st);

    const p = st.player;
    if (p) {
      document.getElementById("hero-name").textContent = p.name || "Adventurer";
      const realms = [p.r1, p.r2].filter(Boolean).join(" / ");
      document.getElementById("hero-sub").textContent = `${p.pers} ${p.race} ${p.class}${realms ? " · " + realms : ""}`;
      document.getElementById("hero-lv").textContent = `Lv ${p.lev}`;
      document.getElementById("mv-lv").textContent = `Lv ${p.lev}`;

      const hpPct = p.mhp > 0 ? Math.max(0, Math.min(100, (100 * p.chp) / p.mhp)) : 100;
      const hpBar = document.getElementById("hp-bar");
      hpBar.style.width = `${hpPct}%`;
      hpBar.classList.toggle("low", hpPct < 35);
      document.getElementById("hp-text").textContent = `${p.chp} / ${p.mhp}`;

      const mvHpBar = document.getElementById("mv-hp-bar");
      mvHpBar.style.width = `${hpPct}%`;
      mvHpBar.classList.toggle("low", hpPct < 35);
      document.getElementById("mv-hp-text").textContent = `${p.chp}/${p.mhp}`;

      const spPct = p.msp > 0 ? Math.max(0, Math.min(100, (100 * p.csp) / p.msp)) : 0;
      const spBar = document.getElementById("sp-bar");
      spBar.style.width = `${p.msp > 0 ? spPct : 0}%`;
      spBar.closest(".bar-row")?.classList.toggle("sp-empty", p.msp <= 0);
      document.getElementById("sp-text").textContent = p.msp > 0 ? `${p.csp} / ${p.msp}` : "—";
      const mvSpBar = document.getElementById("mv-sp-bar");
      mvSpBar.style.width = `${p.msp > 0 ? spPct : 0}%`;
      mvSpBar.closest(".mv-bar-group")?.classList.toggle("sp-empty", p.msp <= 0);
      document.getElementById("mv-sp-text").textContent = p.msp > 0 ? `${p.csp}/${p.msp}` : "—";

      const span = Math.max(1, (p.nextReq || 1) - (p.curReq || 0));
      const xpPct = p.lev >= 50 ? 100 : Math.max(0, Math.min(100, ((p.exp - (p.curReq || 0)) * 100) / span));
      document.getElementById("xp-bar").style.width = `${xpPct}%`;
      document.getElementById("xp-text").textContent = `${p.exp.toLocaleString()}`;

      document.getElementById("stat-ac").textContent = `${p.ac}`;
      document.getElementById("stat-spd").textContent = p.spd >= 0 ? `+${p.spd}` : `${p.spd}`;
      document.getElementById("stat-lite").textContent = `${p.lite}`;

      const depthLabel = p.wild
        ? "Wilderness"
        : p.depth > 0
        ? `${p.depth * 50} ft (Lv ${p.depth})`
        : "Town";
      document.getElementById("pill-depth").textContent = depthLabel;
      document.getElementById("mv-depth").textContent = depthLabel;
      document.getElementById("pill-turn").textContent = p.turn.toLocaleString();
      document.getElementById("pill-gold").textContent = `${p.au.toLocaleString()} gp`;
      document.getElementById("mv-gold").textContent = `${p.au.toLocaleString()} gp`;

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
        el.className = `flag-tag ${fl.kind}`;
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
    const mv = document.getElementById("mv-food");
    let label = "Fed";
    let cls = "";
    if (food < 500) { label = "Faint!"; cls = "bad"; }
    else if (food < 1000) { label = "Weak"; cls = "bad"; }
    else if (food < 2000) { label = "Hungry"; cls = "warn"; }
    else if (food >= 15000) { label = "Gorged"; cls = "warn"; }
    else if (food >= 10000) { label = "Full"; cls = "good"; }
    el.textContent = label;
    el.className = `telem-val ${cls}`.trim();
    if (mv) mv.textContent = label;
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
    const addBtn = (label, action, cls = "") => {
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
      lbl.textContent = "Character Birth — Click an option or use keys";
      bar.appendChild(lbl);
      addBtn("Enter · Confirm", () => this.send({ type: "key", code: 13 }));
      addBtn("Esc · Back", () => this.send({ type: "key", code: 27 }), "ghost");
      addBtn("= · Options", () => this.send({ type: "key", code: "=".charCodeAt(0) }), "ghost");
      addBtn("? · Help", () => this.send({ type: "key", code: "?".charCodeAt(0) }), "ghost");
    } else if (kind === "more") {
      addBtn("Space · Continue", () => this.send({ type: "key", code: 32 }), "warn");
      addBtn("Esc · Dismiss", () => this.send({ type: "key", code: 27 }), "ghost");
    } else if (kind === "yn") {
      if (st.promptText) {
        const lbl = document.createElement("span");
        lbl.className = "prompt-label";
        lbl.textContent = st.promptText;
        bar.appendChild(lbl);
      }
      addBtn("Y · Yes", () => this.send({ type: "key", code: "y".charCodeAt(0) }));
      addBtn("N · No", () => this.send({ type: "key", code: "n".charCodeAt(0) }), "danger");
      addBtn("Esc · Cancel", () => this.send({ type: "key", code: 27 }), "ghost");
    } else if (kind === "dir") {
      const lbl = document.createElement("span");
      lbl.className = "prompt-label";
      lbl.textContent = "Choose direction:";
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
      addBtn("Esc · Cancel", () => this.send({ type: "key", code: 27 }), "ghost");
    } else if (kind === "target") {
      const lbl = document.createElement("span");
      lbl.className = "prompt-label";
      lbl.textContent = "Click tile to target or inspect";
      bar.appendChild(lbl);
      addBtn("Space · Next", () => this.send({ type: "key", code: 32 }));
      addBtn("t · Lock Target", () => this.send({ type: "key", code: "t".charCodeAt(0) }), "warn");
      addBtn("Esc · Cancel", () => this.send({ type: "key", code: 27 }), "ghost");
    } else if (kind === "menu") {
      addBtn("PgUp", () => this.send({ type: "skey", name: "[page_up]", shift: 0, ctrl: 0 }), "ghost");
      addBtn("PgDn", () => this.send({ type: "skey", name: "[page_down]", shift: 0, ctrl: 0 }), "ghost");
      addBtn("? · Help", () => this.send({ type: "key", code: "?".charCodeAt(0) }), "ghost");
      addBtn("Esc · Close", () => this.send({ type: "key", code: 27 }), "warn");
    } else {
      if (st.promptText) {
        const lbl = document.createElement("span");
        lbl.className = "prompt-label";
        lbl.textContent = st.promptText;
        bar.appendChild(lbl);
      }
      addBtn("Enter · Confirm", () => this.send({ type: "key", code: 13 }));
      addBtn("Esc · Cancel", () => this.send({ type: "key", code: 27 }), "ghost");
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
      const [attCls, attText] =
        att === 2 ? ["pet", "Pet"]
        : att === 1 ? ["ally", "Ally"]
        : uniq ? ["unique", "Unique"]
        : sleep ? ["sleep", "Asleep"]
        : ["hostile", "Hostile"];
      item.innerHTML = `
        <div class="list-item-row">
          <span class="item-name">${this.escapeHtml(name)}</span>
          <span class="att-tag ${attCls}">${attText}</span>
        </div>
        <div class="bar-track thin"><div class="bar-fill hp" style="width:${hpPct}%"></div></div>
        <div class="item-actions">
          <button class="mini-btn" data-act="look" ${canRunCmd ? "" : "disabled"}>${iconHtml("eye")} Look</button>
          <button class="mini-btn" data-act="target" ${canRunCmd ? "" : "disabled"}>${iconHtml("target")} Target</button>
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
          <small class="num" style="color:var(--text-muted)">${(it.wgt / 10).toFixed(1)}lb</small>
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
      div.style.opacity = eq.empty ? "0.52" : "1";
      div.innerHTML = `
        <div class="list-item-row">
          <span class="item-name"><span class="slot-tag">${eq.lbl})</span>${this.escapeHtml(eq.name)}</span>
        </div>
        <small style="color:var(--text-muted);font-size:10px">${this.escapeHtml(eq.slotName)}</small>
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
      barFill.style.background = msg.att === 2 ? "#68b068" : msg.att === 1 ? "#5fb3a2" : "#c93640";
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
