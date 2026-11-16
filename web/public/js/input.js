// Modern Keyboard, Mouse, Wheel & Touch Input Controller

const WASD_DIRS = {
  KeyW: "8",
  KeyS: "2",
  KeyA: "4",
  KeyD: "6",
  KeyQ: "7",
  KeyE: "9",
  KeyZ: "1",
  KeyC: "3",
};

const NUMPAD_DIRS = {
  Numpad1: "1",
  Numpad2: "2",
  Numpad3: "3",
  Numpad4: "4",
  Numpad5: "5",
  Numpad6: "6",
  Numpad7: "7",
  Numpad8: "8",
  Numpad9: "9",
};

const SPECIAL_KEYS = {
  ArrowUp: "[up]",
  ArrowDown: "[down]",
  ArrowLeft: "[left]",
  ArrowRight: "[right]",
  Home: "[home]",
  End: "[end]",
  PageUp: "[page_up]",
  PageDown: "[page_down]",
};

export class InputController {
  constructor({ canvas, renderer, send, onToggleControlMode, onZoomChange, onHideTooltip, onShowToast }) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.send = send;
    this.onToggleControlMode = onToggleControlMode;
    this.onZoomChange = onZoomChange;
    this.onHideTooltip = onHideTooltip;
    this.onShowToast = onShowToast || (() => {});

    this.controlMode = "wasd"; // "wasd" | "classic"
    this.enabled = false;
    this._lastHoverKey = "";
    this._lastHoverSent = 0;
    this._hoverTimer = null;
    this._pointerInside = false;
    this._lastPointer = null;
    this._touchTimer = null;
    this._touchLongPressed = false;

    this.bindEvents();
  }

  setEnabled(val) {
    this.enabled = !!val;
    if (!this.enabled) {
      clearTimeout(this._hoverTimer);
      this._lastHoverKey = "";
    }
  }

  setControlMode(mode) {
    this.controlMode = mode === "classic" ? "classic" : "wasd";
  }

  isInputFocused() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
  }

  mouseMods(e) {
    let m = 0;
    if (e.shiftKey) m |= 1;
    if (e.ctrlKey) m |= 2;
    if (e.altKey) m |= 4;
    return m;
  }

  _sendHoverForCell(cell, force = false) {
    if (!cell) {
      this._lastHoverKey = "";
      this.onHideTooltip();
      return;
    }
    const modeTag = cell.inMap ? "M" : "T";
    const key = `${modeTag}:${cell.x},${cell.y}`;
    if (!force && key === this._lastHoverKey) return;

    const now = performance.now();
    const wait = 28 - (now - this._lastHoverSent);
    clearTimeout(this._hoverTimer);

    const dispatch = () => {
      this._lastHoverKey = key;
      this._lastHoverSent = performance.now();
      this.send({ type: "hover", x: cell.x, y: cell.y });
    };

    if (force || wait <= 0) {
      dispatch();
    } else {
      this._hoverTimer = setTimeout(() => {
        if (this.enabled && this._pointerInside) dispatch();
      }, wait);
    }
  }

  refreshHover() {
    if (!this.enabled || !this._pointerInside || !this._lastPointer) return;
    const rect = this.canvas.getBoundingClientRect();
    const cell = this.renderer.pixelToCell(
      this._lastPointer.clientX - rect.left,
      this._lastPointer.clientY - rect.top
    );
    this.renderer.hoverCell = cell;
    if (cell && cell.inMap) {
      this._sendHoverForCell(cell, true);
    } else if (!cell) {
      this.onHideTooltip();
    }
  }

  bindEvents() {
    window.addEventListener("keydown", (e) => this.handleKeyDown(e));

    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.canvas.addEventListener("mousemove", (e) => {
      if (!this.enabled) return;
      this._pointerInside = true;
      this._lastPointer = { clientX: e.clientX, clientY: e.clientY };

      const rect = this.canvas.getBoundingClientRect();
      const cell = this.renderer.pixelToCell(e.clientX - rect.left, e.clientY - rect.top);
      this.renderer.hoverCell = cell;

      if (!cell) {
        clearTimeout(this._hoverTimer);
        this._lastHoverKey = "";
        this.onHideTooltip();
        return;
      }

      const st = this.renderer.state || {};
      if (cell.inMap || st.ctx === 6 /* MOUSE_CTX_BIRTH */) {
        this._sendHoverForCell(cell, false);
      } else {
        this.onHideTooltip();
      }
    });

    this.canvas.addEventListener("mouseleave", () => {
      this._pointerInside = false;
      this._lastPointer = null;
      clearTimeout(this._hoverTimer);
      this.renderer.hoverCell = null;
      this._lastHoverKey = "";
      this.onHideTooltip();
    });

    this.canvas.addEventListener("mousedown", (e) => {
      if (!this.enabled) return;
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
      const rect = this.canvas.getBoundingClientRect();
      const cell = this.renderer.pixelToCell(e.clientX - rect.left, e.clientY - rect.top);

      if (!cell) {
        // Clicking the top banner during "--More--" or prompt acts as Space / Esc
        const py = e.clientY - rect.top;
        if (this.renderer.isMapMode() && py < 34) {
          if (e.button === 2) {
            this.send({ type: "key", code: 27 });
          } else {
            this.send({ type: "key", code: 32 });
          }
        }
        return;
      }

      let btn = 1;
      let mods = this.mouseMods(e);
      if (e.button === 2) {
        btn = 2;
      } else if (e.button === 1) {
        e.preventDefault();
        btn = 3; // middle-click = direct target lock
        mods |= 2;
      }
      this.send({ type: "mouse", x: cell.x, y: cell.y, btn, mods });
    });

    // Basic touch tap & long-press support
    this.canvas.addEventListener(
      "touchstart",
      (e) => {
        if (!this.enabled || e.touches.length !== 1) return;
        const t = e.touches[0];
        this._touchLongPressed = false;
        const rect = this.canvas.getBoundingClientRect();
        const cell = this.renderer.pixelToCell(t.clientX - rect.left, t.clientY - rect.top);
        if (!cell) return;
        this._touchTimer = setTimeout(() => {
          this._touchLongPressed = true;
          this.send({ type: "mouse", x: cell.x, y: cell.y, btn: 2, mods: 0 });
        }, 420);
      },
      { passive: true }
    );

    this.canvas.addEventListener(
      "touchend",
      (e) => {
        clearTimeout(this._touchTimer);
        if (!this.enabled || this._touchLongPressed || e.changedTouches.length !== 1) return;
        const t = e.changedTouches[0];
        const rect = this.canvas.getBoundingClientRect();
        const cell = this.renderer.pixelToCell(t.clientX - rect.left, t.clientY - rect.top);
        if (cell) {
          e.preventDefault();
          this.send({ type: "mouse", x: cell.x, y: cell.y, btn: 1, mods: 0 });
        }
      },
      { passive: false }
    );

    this.canvas.addEventListener("touchmove", () => clearTimeout(this._touchTimer), { passive: true });

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        if (this.renderer.isMapMode()) {
          const next = this.renderer.stepZoom(e.deltaY < 0 ? 1 : -1);
          this.onZoomChange(next);
          this.refreshHover();
        } else {
          const dir = e.deltaY < 0 ? "[up]" : "[down]";
          const big = Math.abs(e.deltaY) >= 90 || e.shiftKey;
          if (big) {
            this.send({ type: "skey", name: e.deltaY < 0 ? "[page_up]" : "[page_down]", shift: 0, ctrl: 0 });
          } else {
            for (let i = 0; i < 3; i++) {
              this.send({ type: "skey", name: dir, shift: 0, ctrl: 0 });
            }
          }
        }
      },
      { passive: false }
    );
  }

  handleKeyDown(e) {
    if (!this.enabled || this.isInputFocused()) return;

    if (e.code === "F2") {
      e.preventDefault();
      this.onToggleControlMode();
      return;
    }

    // Ignore pure modifier keys
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock"].includes(e.key)) return;

    // Allow browser DevTools / refresh shortcuts
    if ((e.ctrlKey && e.shiftKey && (e.code === "KeyI" || e.code === "KeyJ")) || e.code === "F5" || e.code === "F12") {
      return;
    }

    const st = this.renderer.state || {};
    const inMap = this.renderer.isMapMode();
    const pkind = st.promptKind || (st.cmdReady ? "none" : "prompt");
    const allowWasdDir =
      this.controlMode === "wasd" &&
      inMap &&
      (!!st.cmdReady || pkind === "dir" || pkind === "target");

    // Smart WASD + QEZC + X on map prompt, direction prompt, and targeting
    if (allowWasdDir && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (WASD_DIRS[e.code]) {
        e.preventDefault();
        const dir = WASD_DIRS[e.code];
        if (st.cmdReady && e.shiftKey) {
          this.send({ type: "cmd", str: "." + dir });
        } else if (pkind === "target" && e.shiftKey) {
          // Uppercase/fast move in targeting via shifted direction key
          this.send({ type: "skey", name: `[[${dir}]]`, shift: 1, ctrl: 0 });
        } else {
          this.send({ type: "key", code: dir.charCodeAt(0) });
        }
        return;
      }
      if (e.code === "KeyX" && !e.shiftKey && st.cmdReady) {
        e.preventDefault();
        this.send({ type: "key", code: ",".charCodeAt(0) }); // Wait/stay 1 turn
        return;
      }
    }

    // Numpad support via physical e.code (handles Windows Shift+Numpad quirks cleanly)
    if (NUMPAD_DIRS[e.code] && !e.altKey && !e.metaKey) {
      e.preventDefault();
      const dir = NUMPAD_DIRS[e.code];
      if (inMap && st.cmdReady && e.shiftKey) {
        this.send({ type: "cmd", str: "." + dir });
      } else if (inMap && st.cmdReady && e.ctrlKey) {
        this.send({ type: "cmd", str: "+" + dir });
      } else if (e.shiftKey || e.ctrlKey) {
        this.send({ type: "skey", name: `[[${dir}]]`, shift: e.shiftKey ? 1 : 0, ctrl: e.ctrlKey ? 1 : 0 });
      } else {
        this.send({ type: "key", code: dir.charCodeAt(0) });
      }
      return;
    }
    if (e.code === "Numpad0" || e.code === "NumpadDecimal") {
      e.preventDefault();
      this.send({ type: "key", code: (e.code === "Numpad0" ? "0" : ".").charCodeAt(0) });
      return;
    }

    // Arrow / Nav keys -> SDL-style special keys
    if (SPECIAL_KEYS[e.code]) {
      e.preventDefault();
      this.send({
        type: "skey",
        name: SPECIAL_KEYS[e.code],
        shift: e.shiftKey ? 1 : 0,
        ctrl: e.ctrlKey ? 1 : 0,
      });
      return;
    }

    // Control + Letter -> ASCII 1..26
    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
      const upper = e.key.toUpperCase().charCodeAt(0);
      if (upper >= 65 && upper <= 90) {
        e.preventDefault();
        this.send({ type: "key", code: upper - 64 });
        return;
      }
    }

    // Standard editing / control keys
    if (e.key === "Enter") {
      e.preventDefault();
      this.send({ type: "key", code: 13 });
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      this.send({ type: "key", code: 27 });
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      this.send({ type: "key", code: 8 });
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      this.send({ type: "key", code: 127 });
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      this.send({ type: "key", code: 9 });
      return;
    }

    // Printable single-character key
    if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
      const code = e.key.charCodeAt(0);
      if (code >= 32 && code < 127) {
        e.preventDefault();
        this.send({ type: "key", code });
      }
    }
  }
}
