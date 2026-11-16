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
  constructor({ canvas, renderer, send, onToggleControlMode, onZoomChange, onHideTooltip }) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.send = send;
    this.onToggleControlMode = onToggleControlMode;
    this.onZoomChange = onZoomChange;
    this.onHideTooltip = onHideTooltip;

    this.controlMode = "wasd"; // "wasd" | "classic"
    this.enabled = false;
    this._lastHoverKey = "";
    this._lastHoverSent = 0;

    this.bindEvents();
  }

  setEnabled(val) {
    this.enabled = !!val;
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

  bindEvents() {
    window.addEventListener("keydown", (e) => this.handleKeyDown(e));

    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.canvas.addEventListener("mousemove", (e) => {
      if (!this.enabled) return;
      const rect = this.canvas.getBoundingClientRect();
      const cell = this.renderer.pixelToCell(e.clientX - rect.left, e.clientY - rect.top);
      this.renderer.hoverCell = cell;

      if (!cell) {
        this.onHideTooltip();
        return;
      }

      const key = `${cell.x},${cell.y}`;
      const now = performance.now();
      if (key !== this._lastHoverKey && now - this._lastHoverSent > 24) {
        this._lastHoverKey = key;
        this._lastHoverSent = now;
        this.send({ type: "hover", x: cell.x, y: cell.y });
      }
    });

    this.canvas.addEventListener("mouseleave", () => {
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
      if (!cell) return;

      let btn = 1;
      let mods = this.mouseMods(e);
      if (e.button === 2) {
        btn = 2;
      } else if (e.button === 1) {
        e.preventDefault();
        btn = 1;
        mods |= 2; // middle-click = target
      }
      this.send({ type: "mouse", x: cell.x, y: cell.y, btn, mods });
    });

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        if (this.renderer.isMapMode()) {
          const next = this.renderer.stepZoom(e.deltaY < 0 ? 1 : -1);
          this.onZoomChange(next);
        } else {
          this.send({ type: "skey", name: e.deltaY < 0 ? "[page_up]" : "[page_down]", shift: 0, ctrl: 0 });
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
    if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(e.key)) return;

    // Allow browser DevTools / refresh shortcuts
    if ((e.ctrlKey && e.shiftKey && (e.code === "KeyI" || e.code === "KeyJ")) || e.code === "F5" || e.code === "F12") {
      return;
    }

    const st = this.renderer.state || {};
    const onMapPrompt = this.renderer.isMapMode() && !!st.cmdReady;

    // Smart WASD + QEZC + X on main map command prompt
    if (this.controlMode === "wasd" && onMapPrompt && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (WASD_DIRS[e.code]) {
        e.preventDefault();
        const dir = WASD_DIRS[e.code];
        if (e.shiftKey) {
          this.send({ type: "cmd", str: "." + dir });
        } else {
          this.send({ type: "key", code: dir.charCodeAt(0) });
        }
        return;
      }
      if (e.code === "KeyX" && !e.shiftKey) {
        e.preventDefault();
        this.send({ type: "key", code: ".".charCodeAt(0) });
        return;
      }
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
