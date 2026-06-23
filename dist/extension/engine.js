"use strict";
(() => {
  // src/core/event-bus.ts
  function createEventBus() {
    const handlers = /* @__PURE__ */ new Map();
    return {
      emit(event, payload) {
        handlers.get(event)?.forEach((h) => h(payload));
      },
      on(event, handler) {
        if (!handlers.has(event)) handlers.set(event, /* @__PURE__ */ new Set());
        const set = handlers.get(event);
        set.add(handler);
        return () => set.delete(handler);
      }
    };
  }

  // src/core/state.ts
  function createStateStore() {
    const store = /* @__PURE__ */ new Map();
    const subs = /* @__PURE__ */ new Map();
    return {
      get(key) {
        return store.get(key);
      },
      set(key, value) {
        store.set(key, value);
        subs.get(key)?.forEach((cb) => cb(value));
      },
      subscribe(key, callback) {
        if (!subs.has(key)) subs.set(key, /* @__PURE__ */ new Set());
        const set = subs.get(key);
        set.add(callback);
        return () => set.delete(callback);
      }
    };
  }

  // src/game/game-data.ts
  function getGameData() {
    const raw = window.game_data;
    if (!raw || typeof raw.screen !== "string") return null;
    return JSON.parse(JSON.stringify(raw));
  }

  // src/game/screen.ts
  function matchesScreen(allowed, screen) {
    return allowed.some((a) => a === "*" || a === screen);
  }

  // src/core/registry.ts
  function createRegistry(shared) {
    const modules = /* @__PURE__ */ new Map();
    const active = /* @__PURE__ */ new Set();
    const pending = /* @__PURE__ */ new Set();
    function buildContext(module) {
      return {
        state: shared.state,
        eventBus: shared.eventBus,
        services: {
          ...shared.services,
          // Each module gets a logger scoped to its own id
          logger: shared.services.logger.scoped(module.manifest.id)
        },
        manifest: module.manifest
      };
    }
    return {
      register(module) {
        modules.set(module.manifest.id, module);
      },
      // Returns manifests whose allowedScreens match the raw runtime screen string.
      // Never throws on an unknown screen — an unrecognised screen simply matches nothing.
      available(screen) {
        return Array.from(modules.values()).filter((m) => matchesScreen(m.manifest.allowedScreens, screen)).map((m) => m.manifest);
      },
      async activate(id) {
        if (active.has(id) || pending.has(id)) return;
        const module = modules.get(id);
        if (!module) return;
        pending.add(id);
        try {
          await module.init(buildContext(module));
          active.add(id);
        } finally {
          pending.delete(id);
        }
      },
      deactivate(id) {
        if (!active.has(id)) return;
        active.delete(id);
        modules.get(id)?.destroy();
      },
      list() {
        return Array.from(modules.values()).map((m) => m.manifest);
      },
      isActive(id) {
        return active.has(id);
      }
    };
  }

  // src/services/game-data-service.ts
  function createGameDataService() {
    const data = getGameData();
    return {
      snapshot: () => data
    };
  }

  // src/services/logger.ts
  function makeLogger(prefix) {
    return {
      info: (...args) => console.info(prefix, ...args),
      warn: (...args) => console.warn(prefix, ...args),
      error: (...args) => console.error(prefix, ...args),
      scoped: (ns) => makeLogger(`${prefix}:${ns}`)
    };
  }
  function createLogger(namespace = "Phantom") {
    return makeLogger(`[Phantom:${namespace}]`);
  }

  // src/services/storage.ts
  function createStorageService() {
    const domain = window.location.hostname;
    const prefix = `phantom:${domain}:`;
    return {
      async get(key) {
        const raw = localStorage.getItem(prefix + key);
        if (raw === null) return void 0;
        try {
          return JSON.parse(raw);
        } catch {
          return void 0;
        }
      },
      async set(key, value) {
        localStorage.setItem(prefix + key, JSON.stringify(value));
      },
      async remove(key) {
        localStorage.removeItem(prefix + key);
      },
      async list() {
        const result = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith(prefix)) result.push(k.slice(prefix.length));
        }
        return result;
      }
    };
  }

  // src/ui/window.ts
  function createWindowDom(root, opts) {
    let destroyed = false;
    let minimized = false;
    let dragging = false;
    let dragOx = 0;
    let dragOy = 0;
    let posX = opts.pos.x;
    let posY = opts.pos.y;
    const el = document.createElement("div");
    el.className = "ph-window";
    el.style.cssText = `width:${opts.size.w}px;height:${opts.size.h}px;left:${posX}px;top:${posY}px`;
    const titlebar = document.createElement("div");
    titlebar.className = "ph-win-titlebar";
    const titleEl = document.createElement("span");
    titleEl.className = "ph-win-title";
    titleEl.textContent = opts.title;
    const btnMin = document.createElement("button");
    btnMin.className = "ph-win-btn";
    btnMin.title = "Minimizar";
    btnMin.textContent = "-";
    const btnClose = document.createElement("button");
    btnClose.className = "ph-win-btn ph-win-btn-close";
    btnClose.title = "Fechar";
    btnClose.textContent = "x";
    titlebar.append(titleEl, btnMin, btnClose);
    const contentEl = document.createElement("div");
    contentEl.className = "ph-win-content";
    el.append(titlebar, contentEl);
    root.appendChild(el);
    el.addEventListener("mousedown", () => opts.onFocus(), { capture: true });
    const clampPos = (x, y) => {
      const margin = 12;
      const topMargin = 40;
      const rect = el.getBoundingClientRect();
      const width = rect.width || opts.size.w;
      const height = minimized ? titlebar.offsetHeight : rect.height || opts.size.h;
      const maxX = Math.max(margin, window.innerWidth - width - margin);
      const maxY = Math.max(topMargin, window.innerHeight - height - margin);
      return {
        x: Math.max(margin, Math.min(x, maxX)),
        y: Math.max(topMargin, Math.min(y, maxY))
      };
    };
    const applyPos = (x, y) => {
      const clamped = clampPos(x, y);
      posX = clamped.x;
      posY = clamped.y;
      el.style.left = `${posX}px`;
      el.style.top = `${posY}px`;
    };
    applyPos(posX, posY);
    const onMove = (e) => {
      if (!dragging) return;
      applyPos(e.clientX - dragOx, e.clientY - dragOy);
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      opts.onStateChange?.();
    };
    titlebar.addEventListener("mousedown", (e) => {
      if (e.target === btnMin || e.target === btnClose) return;
      dragging = true;
      dragOx = e.clientX - posX;
      dragOy = e.clientY - posY;
      e.preventDefault();
    });
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    btnMin.addEventListener("click", () => minimized ? restore() : minimize());
    btnClose.addEventListener("click", () => opts.onClose());
    function minimize() {
      minimized = true;
      contentEl.style.display = "none";
      el.classList.add("ph-minimized");
      el.style.height = "auto";
      btnMin.textContent = "+";
      btnMin.title = "Restaurar";
      applyPos(posX, posY);
      opts.onStateChange?.();
    }
    function restore() {
      minimized = false;
      contentEl.style.display = "";
      el.classList.remove("ph-minimized");
      btnMin.textContent = "-";
      btnMin.title = "Minimizar";
      el.style.height = `${opts.size.h}px`;
      applyPos(posX, posY);
      opts.onStateChange?.();
    }
    return {
      el,
      contentEl,
      setTitle: (t) => {
        titleEl.textContent = t;
      },
      setZIndex: (z) => {
        el.style.zIndex = String(z);
      },
      setPos: (x, y) => {
        applyPos(x, y);
        opts.onStateChange?.();
      },
      getPos: () => ({ x: posX, y: posY }),
      minimize,
      restore,
      isMinimized: () => minimized,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        el.remove();
      }
    };
  }

  // src/services/window-manager.ts
  var DEFAULT_SIZE = { w: 420, h: 360 };
  var BASE_Z = 10100;
  var CASCADE = { x: 100, y: 60, step: 24, max: 8 };
  var VIEWPORT_MARGIN = 12;
  var TOP_MARGIN = 40;
  function createWindowManager(storage) {
    let root = document.getElementById("phantom-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "phantom-root";
      document.body.appendChild(root);
    }
    const rootEl = root;
    const windows = /* @__PURE__ */ new Map();
    const closedListeners = [];
    let zCounter = 0;
    let cascadeIdx = 0;
    function focusWin(moduleId) {
      const entry = windows.get(moduleId);
      if (!entry) return;
      zCounter++;
      entry.dom.setZIndex(BASE_Z + zCounter);
    }
    function persistWin(moduleId, dom) {
      const pos = dom.getPos();
      void storage.set(`win:${moduleId}`, {
        x: pos.x,
        y: pos.y,
        minimized: dom.isMinimized()
      });
    }
    function clampSize(size) {
      return {
        w: Math.min(size.w, Math.max(280, window.innerWidth - VIEWPORT_MARGIN * 2)),
        h: Math.min(size.h, Math.max(120, window.innerHeight - TOP_MARGIN - VIEWPORT_MARGIN))
      };
    }
    function clampPos(pos, size) {
      const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - size.w - VIEWPORT_MARGIN);
      const maxY = Math.max(TOP_MARGIN, window.innerHeight - size.h - VIEWPORT_MARGIN);
      return {
        x: Math.max(VIEWPORT_MARGIN, Math.min(pos.x, maxX)),
        y: Math.max(TOP_MARGIN, Math.min(pos.y, maxY))
      };
    }
    function destroyWin(moduleId) {
      const entry = windows.get(moduleId);
      if (!entry) return;
      windows.delete(moduleId);
      persistWin(moduleId, entry.dom);
      entry.dom.destroy();
      closedListeners.forEach((cb) => cb(moduleId));
    }
    return {
      open(spec) {
        const { moduleId, singleInstance = true } = spec;
        const existing = windows.get(moduleId);
        if (existing && singleInstance) {
          focusWin(moduleId);
          existing.dom.restore();
          return existing.handle;
        }
        const size = clampSize(spec.defaultSize ?? DEFAULT_SIZE);
        const fallbackPos = {
          x: CASCADE.x + cascadeIdx % CASCADE.max * CASCADE.step,
          y: CASCADE.y + cascadeIdx % CASCADE.max * CASCADE.step
        };
        cascadeIdx++;
        const initialPos = clampPos(spec.defaultPos ?? fallbackPos, size);
        let handle;
        let hydrating = false;
        const dom = createWindowDom(rootEl, {
          title: spec.title,
          size,
          pos: initialPos,
          onClose: () => handle.close(),
          onFocus: () => focusWin(moduleId),
          onStateChange: () => {
            if (!hydrating) persistWin(moduleId, dom);
          }
        });
        zCounter++;
        dom.setZIndex(BASE_Z + zCounter);
        void storage.get(`win:${moduleId}`).then((saved) => {
          if (!saved || !windows.has(moduleId)) return;
          const restored = clampPos({ x: saved.x, y: saved.y }, size);
          hydrating = true;
          try {
            dom.setPos(restored.x, restored.y);
            if (saved.minimized) dom.minimize();
          } finally {
            hydrating = false;
          }
          persistWin(moduleId, dom);
        });
        handle = {
          id: moduleId,
          contentEl: dom.contentEl,
          focus: () => focusWin(moduleId),
          setTitle: (t) => dom.setTitle(t),
          close: () => destroyWin(moduleId)
        };
        windows.set(moduleId, { dom, handle });
        return handle;
      },
      close(moduleId) {
        destroyWin(moduleId);
      },
      get(moduleId) {
        return windows.get(moduleId)?.handle ?? null;
      },
      onWindowClosed(cb) {
        closedListeners.push(cb);
        return () => {
          const i = closedListeners.indexOf(cb);
          if (i > -1) closedListeners.splice(i, 1);
        };
      }
    };
  }

  // src/services/request.ts
  function createRequestService(gameData) {
    function buildUrl(opts) {
      const gd = gameData.snapshot();
      const village = opts.village ?? gd?.village.id ?? "";
      const csrf = gd?.csrf ?? "";
      const sitter = gd?.player.sitter;
      const url = new URL("/game.php", window.location.origin);
      url.searchParams.set("village", String(village));
      url.searchParams.set("screen", opts.screen);
      url.searchParams.set("action", opts.action);
      url.searchParams.set("h", csrf);
      url.searchParams.set("ajax", "1");
      if (sitter) url.searchParams.set("t", String(sitter));
      return url.toString();
    }
    return {
      post(opts) {
        const body = opts.body ? new URLSearchParams(opts.body) : void 0;
        return fetch(buildUrl(opts), {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body
        });
      },
      get(path, init) {
        return fetch(path, { credentials: "same-origin", ...init });
      },
      editVillageNote(currentVillageId, targetVillageId, note) {
        const gd = gameData.snapshot();
        const csrf = gd?.csrf ?? "";
        const sitter = gd?.player.sitter;
        const url = new URL("/game.php", window.location.origin);
        url.searchParams.set("village", currentVillageId);
        url.searchParams.set("screen", "info_village");
        url.searchParams.set("id", targetVillageId);
        url.searchParams.set("ajaxaction", "edit_notes");
        url.searchParams.set("h", csrf);
        if (sitter) url.searchParams.set("t", String(sitter));
        return fetch(url.toString(), {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ note })
        });
      }
    };
  }

  // src/ui/theme.ts
  var THEME_ID = "phantom-theme";
  function injectTheme() {
    if (document.getElementById(THEME_ID)) return;
    const style = document.createElement("style");
    style.id = THEME_ID;
    style.textContent = `
    :root {
      --ph-bg:         #1a1410;
      --ph-bg-light:   #2a1f14;
      --ph-border:     #5c4a2a;
      --ph-gold:       #d4aa70;
      --ph-gold-light: #e8c896;
      --ph-green:      #5a8c3a;
      --ph-text:       #c8b89a;
      --ph-text-dim:   #8a7a6a;
      --ph-radius:     4px;
      --ph-panel-bg:   var(--ph-bg);
      --ph-panel-bg-image: none;
      --ph-panel-header-bg: var(--ph-bg-light);
      --ph-panel-border: var(--ph-border);
      --ph-panel-accent: var(--ph-gold);
      --ph-panel-top: 72px;
      --ph-panel-left: 8px;
      --ph-brand-radius: 3px;
      --ph-launcher-mark-size: 25px;
      --ph-header-mark-size: 26px;
      --ph-z-dock:     2147482000;
      --ph-z-launcher: 2147482001;
      --ph-z-root:     2147483000;
    }

    #phantom-launcher {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 27px;
      height: 27px;
      cursor: pointer;
      background: var(--ph-bg);
      border: 1px solid var(--ph-border);
      border-radius: var(--ph-radius);
      color: var(--ph-gold);
      z-index: var(--ph-z-launcher);
      user-select: none;
      box-sizing: border-box;
      overflow: hidden;
    }
    #phantom-launcher:hover {
      border-color: var(--ph-gold);
      color: var(--ph-gold-light);
    }
    .ph-launcher-mark {
      width: var(--ph-launcher-mark-size);
      height: var(--ph-launcher-mark-size);
      border-radius: var(--ph-brand-radius);
      object-fit: cover;
      display: block;
      pointer-events: none;
    }

    #phantom-dock {
      position: fixed;
      top: var(--ph-panel-top);
      left: var(--ph-panel-left);
      width: min(560px, calc(100vw - 24px));
      max-height: min(620px, calc(100vh - 96px));
      background-color: var(--ph-panel-bg);
      background-image: var(--ph-panel-bg-image);
      background-size: cover;
      background-position: center;
      border: 1px solid var(--ph-panel-border);
      border-radius: var(--ph-radius);
      color: var(--ph-text);
      font-family: Verdana, sans-serif;
      font-size: 11px;
      z-index: var(--ph-z-dock);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      pointer-events: auto;
      box-shadow: 0 4px 22px rgba(0,0,0,0.65);
    }
    #phantom-dock.ph-hidden { display: none; }

    .ph-dock-header {
      min-height: 42px;
      padding: 7px 9px;
      border-bottom: 1px solid var(--ph-panel-border);
      background: var(--ph-panel-header-bg);
      user-select: none;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .ph-dock-brand {
      width: 28px;
      height: 28px;
      border: 1px solid var(--ph-panel-border);
      border-radius: var(--ph-brand-radius);
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--ph-bg);
      overflow: hidden;
      flex-shrink: 0;
    }

    .ph-brand-mark {
      width: var(--ph-header-mark-size);
      height: var(--ph-header-mark-size);
      border-radius: var(--ph-brand-radius);
      object-fit: cover;
      display: block;
      pointer-events: none;
    }

    .ph-dock-titleblock {
      min-width: 0;
      flex: 1;
    }

    .ph-dock-title {
      color: var(--ph-panel-accent);
      font-weight: bold;
      font-size: 13px;
      line-height: 15px;
    }

    .ph-dock-version {
      color: var(--ph-text-dim);
      font-size: 9px;
      line-height: 12px;
    }

    .ph-dock-close {
      width: 22px;
      height: 22px;
      border: 1px solid var(--ph-panel-border);
      border-radius: var(--ph-radius);
      background: var(--ph-bg);
      color: var(--ph-text-dim);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      line-height: 1;
      flex-shrink: 0;
    }
    .ph-dock-close:hover {
      color: var(--ph-gold-light);
      border-color: var(--ph-panel-accent);
    }

    .ph-dock-body {
      display: grid;
      grid-template-columns: 155px minmax(0, 1fr);
      min-height: 0;
      overflow: hidden;
    }

    .ph-dock-sidebar {
      border-right: 1px solid var(--ph-panel-border);
      background: rgba(42,31,20,0.72);
      padding: 6px;
      overflow-y: auto;
      max-height: calc(min(620px, calc(100vh - 96px)) - 43px);
    }

    .ph-category-tab {
      width: 100%;
      min-height: 30px;
      border: 1px solid transparent;
      border-radius: var(--ph-radius);
      background: transparent;
      color: var(--ph-text);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 5px 6px;
      margin-bottom: 4px;
      font-size: 10px;
      text-align: left;
    }
    .ph-category-tab:hover,
    .ph-category-tab.ph-selected {
      background: var(--ph-bg-light);
      border-color: var(--ph-panel-border);
      color: var(--ph-gold-light);
    }

    .ph-category-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ph-category-badge {
      min-width: 16px;
      height: 16px;
      border-radius: 8px;
      background: var(--ph-bg);
      border: 1px solid var(--ph-panel-border);
      color: var(--ph-panel-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 9px;
      flex-shrink: 0;
    }

    .ph-dock-content {
      min-width: 0;
      overflow-y: auto;
      max-height: calc(min(620px, calc(100vh - 96px)) - 43px);
      padding: 8px;
    }
    .ph-dock-sidebar::-webkit-scrollbar,
    .ph-dock-content::-webkit-scrollbar { width: 4px; }
    .ph-dock-sidebar::-webkit-scrollbar-track,
    .ph-dock-content::-webkit-scrollbar-track { background: var(--ph-bg); }
    .ph-dock-sidebar::-webkit-scrollbar-thumb,
    .ph-dock-content::-webkit-scrollbar-thumb { background: var(--ph-border); border-radius: 2px; }

    .ph-content-heading {
      color: var(--ph-panel-accent);
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 7px;
    }

    .ph-module-card {
      border: 1px solid var(--ph-panel-border);
      border-radius: var(--ph-radius);
      background: rgba(26,20,16,0.88);
      padding: 7px;
      margin-bottom: 7px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
    }

    .ph-module-card-main {
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 7px;
    }

    .ph-module-text {
      min-width: 0;
      flex: 1;
    }

    .ph-mod-icon {
      font-size: 14px;
      width: 18px;
      text-align: center;
      flex-shrink: 0;
    }

    .ph-mod-name {
      color: var(--ph-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: bold;
    }

    .ph-mod-meta {
      margin-top: 2px;
      color: var(--ph-text-dim);
      font-size: 9px;
    }

    .ph-module-controls {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      flex-shrink: 0;
    }

    .ph-indicator {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--ph-text-dim);
      flex-shrink: 0;
    }
    .ph-indicator.ph-active { background: var(--ph-green); }

    .ph-toggle {
      appearance: none;
      -webkit-appearance: none;
      width: 28px;
      height: 15px;
      border-radius: 8px;
      background: var(--ph-text-dim);
      position: relative;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    .ph-toggle:checked { background: var(--ph-green); }
    .ph-toggle::after {
      content: '';
      position: absolute;
      width: 11px;
      height: 11px;
      border-radius: 50%;
      background: #fff;
      top: 2px;
      left: 2px;
      transition: left 0.15s;
    }
    .ph-toggle:checked::after { left: 15px; }

    .ph-btn-run {
      min-width: 42px;
      height: 22px;
      padding: 2px 7px;
      background: var(--ph-bg-light);
      border: 1px solid var(--ph-border);
      border-radius: var(--ph-radius);
      color: var(--ph-gold);
      cursor: pointer;
      font-size: 9px;
      flex-shrink: 0;
    }
    .ph-btn-run:hover { border-color: var(--ph-gold); color: var(--ph-gold-light); }

    /* --- Toggle open/close button (Phase 2) --- */
    .ph-btn-toggle {
      min-width: 48px;
      height: 22px;
      padding: 2px 7px;
      background: var(--ph-bg-light);
      border: 1px solid var(--ph-border);
      border-radius: var(--ph-radius);
      color: var(--ph-gold);
      cursor: pointer;
      font-size: 9px;
      flex-shrink: 0;
    }
    .ph-btn-toggle:hover:not(:disabled) { border-color: var(--ph-gold); color: var(--ph-gold-light); }
    .ph-btn-toggle:disabled { color: var(--ph-text-dim); cursor: default; }

    .ph-dock-empty {
      color: var(--ph-text-dim);
      padding: 12px;
      text-align: center;
    }

    @media (max-width: 560px) {
      #phantom-dock {
        width: calc(100vw - 16px);
      }
      .ph-dock-body {
        grid-template-columns: 120px minmax(0, 1fr);
      }
      .ph-module-card {
        grid-template-columns: minmax(0, 1fr);
      }
      .ph-module-controls {
        justify-content: flex-start;
      }
    }

    /* --- Window Manager root (Phase 2) --- */
    #phantom-root {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: var(--ph-z-root);
      overflow: visible;
    }

    .ph-window {
      position: absolute;
      pointer-events: auto;
      background: var(--ph-bg);
      border: 1px solid var(--ph-border);
      border-radius: var(--ph-radius);
      min-width: 280px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.65);
    }

    .ph-win-titlebar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 5px 8px;
      background: var(--ph-bg-light);
      border-bottom: 1px solid var(--ph-border);
      cursor: move;
      user-select: none;
      flex-shrink: 0;
    }

    .ph-win-title {
      flex: 1;
      color: var(--ph-gold);
      font-weight: bold;
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ph-win-btn {
      width: 18px;
      height: 18px;
      border: 1px solid var(--ph-border);
      border-radius: 3px;
      background: var(--ph-bg);
      color: var(--ph-text-dim);
      cursor: pointer;
      font-size: 10px;
      line-height: 1;
      padding: 0;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ph-win-btn:hover { color: var(--ph-text); border-color: var(--ph-gold); }
    .ph-win-btn-close:hover { color: #e44; border-color: #e44; }

    .ph-window.ph-minimized { height: auto !important; min-height: 0 !important; }
    .ph-window.ph-minimized .ph-win-content { display: none; }

    .ph-win-content {
      flex: 1;
      overflow: auto;
      padding: 8px;
      color: var(--ph-text);
      font-size: 11px;
    }
    .ph-win-content::-webkit-scrollbar { width: 4px; height: 4px; }
    .ph-win-content::-webkit-scrollbar-track { background: var(--ph-bg); }
    .ph-win-content::-webkit-scrollbar-thumb { background: var(--ph-border); border-radius: 2px; }

    /* --- Notas Manuais module (Phase 3) --- */
    .ph-nm-section { margin-bottom: 8px; }
    .ph-nm-label {
      display: block;
      color: var(--ph-gold);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      margin-bottom: 3px;
    }
    .ph-nm-textarea {
      width: 100%;
      box-sizing: border-box;
      background: var(--ph-bg-light);
      border: 1px solid var(--ph-border);
      border-radius: var(--ph-radius);
      color: var(--ph-text);
      font-size: 11px;
      font-family: monospace;
      padding: 4px;
      resize: vertical;
    }
    .ph-nm-textarea:focus { outline: 1px solid var(--ph-gold); }
    .ph-nm-presets { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
    .ph-nm-preset {
      padding: 2px 6px;
      font-size: 9px;
      background: var(--ph-bg-light);
      border: 1px solid var(--ph-border);
      border-radius: var(--ph-radius);
      color: var(--ph-text);
      cursor: pointer;
    }
    .ph-nm-preset:hover { border-color: var(--ph-gold); color: var(--ph-gold); }
    .ph-nm-actions { display: flex; gap: 6px; margin-bottom: 8px; }
    .ph-nm-btn {
      flex: 1;
      padding: 4px;
      background: var(--ph-bg-light);
      border: 1px solid var(--ph-border);
      border-radius: var(--ph-radius);
      color: var(--ph-gold);
      cursor: pointer;
      font-size: 10px;
    }
    .ph-nm-btn:hover:not(:disabled) { border-color: var(--ph-gold-light); color: var(--ph-gold-light); }
    .ph-nm-btn:disabled { color: var(--ph-text-dim); cursor: default; }
    .ph-nm-btn-stop { color: #c84; border-color: #a63; }
    .ph-nm-btn-stop:hover:not(:disabled) { color: #f96; border-color: #f96; }
    .ph-nm-progress-track {
      width: 100%;
      height: 6px;
      background: var(--ph-bg-light);
      border: 1px solid var(--ph-border);
      border-radius: 3px;
      overflow: hidden;
      margin-bottom: 3px;
    }
    .ph-nm-progress-fill {
      height: 100%;
      background: var(--ph-green);
      border-radius: 3px;
      width: 0%;
      transition: width 0.2s;
    }
    .ph-nm-progress-text { font-size: 10px; color: var(--ph-text-dim); margin-bottom: 6px; }
    .ph-nm-log {
      background: var(--ph-bg-light);
      border: 1px solid var(--ph-border);
      border-radius: var(--ph-radius);
      padding: 4px;
      font-size: 10px;
      font-family: monospace;
      max-height: 130px;
      overflow-y: auto;
    }
    .ph-nm-log-line { margin: 0; padding: 1px 0; }
    .ph-nm-log-line.ok   { color: var(--ph-green); }
    .ph-nm-log-line.err  { color: #e55; }
    .ph-nm-log-line.info { color: var(--ph-text-dim); }

    /* --- Renomear a Cores module (Phase 4) --- */
    .ph-rc-group {
      display: inline-flex;
      gap: 2px;
      margin-left: 4px;
      vertical-align: middle;
    }
    .ph-rc-btn {
      padding: 1px 5px;
      border: 1px solid var(--ph-rc-color, #888);
      border-radius: 2px;
      background: transparent;
      color: var(--ph-rc-color, #ccc);
      cursor: pointer;
      font-size: 9px;
      font-family: Verdana, sans-serif;
      white-space: nowrap;
      line-height: 14px;
    }
    .ph-rc-btn:hover {
      background: var(--ph-rc-color, #888);
      color: #fff;
    }
  `;
    document.head.appendChild(style);
  }

  // src/ui/utils.ts
  function waitForElement(id, timeoutMs) {
    const el = document.getElementById(id);
    if (el) return Promise.resolve(el);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
      const observer = new MutationObserver(() => {
        const found = document.getElementById(id);
        if (found) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(found);
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  // src/ui/brand.ts
  var PHANTOM_MARK_DATA_URI = "data:image/png;base64,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";

  // src/ui/shell/index.ts
  var CATEGORY_LABELS = {
    "overview": "Overview",
    "farm-economy": "Farm & Economy",
    "attack-defense": "Attack & Defense",
    "planning": "Planning",
    "map": "Map",
    "utilities": "Utilities",
    "automation": "Automation",
    "tribe": "Tribe"
  };
  var CATEGORY_ORDER = [
    "overview",
    "farm-economy",
    "attack-defense",
    "planning",
    "map",
    "utilities",
    "automation",
    "tribe"
  ];
  var AUTO_KINDS = ["auto", "page", "background"];
  function createDock(modules, enabledState, callbacks) {
    const dock = document.createElement("div");
    dock.id = "phantom-dock";
    dock.classList.add("ph-hidden");
    const header = document.createElement("div");
    header.className = "ph-dock-header";
    const brand = document.createElement("div");
    brand.className = "ph-dock-brand";
    const brandMark = document.createElement("img");
    brandMark.className = "ph-brand-mark";
    brandMark.src = PHANTOM_MARK_DATA_URI;
    brandMark.alt = "";
    brandMark.setAttribute("aria-hidden", "true");
    brand.appendChild(brandMark);
    const titleBlock = document.createElement("div");
    titleBlock.className = "ph-dock-titleblock";
    const title = document.createElement("div");
    title.className = "ph-dock-title";
    title.textContent = "Phantom";
    const version = document.createElement("div");
    version.className = "ph-dock-version";
    version.textContent = "v0.1";
    titleBlock.append(title, version);
    const closeBtn = document.createElement("button");
    closeBtn.className = "ph-dock-close";
    closeBtn.type = "button";
    closeBtn.title = "Fechar";
    closeBtn.textContent = "\xD7";
    closeBtn.addEventListener("click", () => dock.classList.add("ph-hidden"));
    header.append(brand, titleBlock, closeBtn);
    dock.appendChild(header);
    const body = document.createElement("div");
    body.className = "ph-dock-body";
    dock.appendChild(body);
    const sidebar = document.createElement("div");
    sidebar.className = "ph-dock-sidebar";
    const content = document.createElement("div");
    content.className = "ph-dock-content";
    body.append(sidebar, content);
    const groups = /* @__PURE__ */ new Map();
    for (const mod of modules) {
      const list = groups.get(mod.category) ?? [];
      list.push(mod);
      groups.set(mod.category, list);
    }
    const visibleCategories = CATEGORY_ORDER;
    let selectedCategory = CATEGORY_ORDER.find((cat) => (groups.get(cat) ?? []).length > 0) ?? null;
    const activeState = /* @__PURE__ */ new Map();
    const indicators = /* @__PURE__ */ new Map();
    const toggleBtns = /* @__PURE__ */ new Map();
    const enableToggles = /* @__PURE__ */ new Map();
    const categoryBtns = /* @__PURE__ */ new Map();
    const categoryBadges = /* @__PURE__ */ new Map();
    let renderedModuleIds = [];
    let destroyed = false;
    const activeCount = (cat) => {
      const mods = groups.get(cat) ?? [];
      return mods.filter((mod) => activeState.get(mod.id)).length;
    };
    const updateCategoryChrome = () => {
      for (const cat of visibleCategories) {
        const btn = categoryBtns.get(cat);
        const badge = categoryBadges.get(cat);
        btn?.classList.toggle("ph-selected", cat === selectedCategory);
        if (badge) badge.textContent = String(activeCount(cat));
      }
    };
    const renderContent = () => {
      for (const id of renderedModuleIds) {
        indicators.delete(id);
        toggleBtns.delete(id);
        enableToggles.delete(id);
      }
      renderedModuleIds = [];
      content.replaceChildren();
      if (!selectedCategory) {
        const empty = document.createElement("div");
        empty.className = "ph-dock-empty";
        empty.textContent = "Nenhum m\xF3dulo dispon\xEDvel neste ecr\xE3";
        content.appendChild(empty);
        return;
      }
      const heading = document.createElement("div");
      heading.className = "ph-content-heading";
      heading.textContent = CATEGORY_LABELS[selectedCategory];
      content.appendChild(heading);
      const mods = groups.get(selectedCategory) ?? [];
      if (mods.length === 0) {
        const empty = document.createElement("div");
        empty.className = "ph-dock-empty";
        empty.textContent = "Nenhum m\xF3dulo dispon\xEDvel neste ecr\xE3";
        content.appendChild(empty);
        return;
      }
      for (const mod of mods) {
        renderedModuleIds.push(mod.id);
        const card = document.createElement("div");
        card.className = "ph-module-card";
        const cardMain = document.createElement("div");
        cardMain.className = "ph-module-card-main";
        const iconEl = document.createElement("span");
        iconEl.className = "ph-mod-icon";
        iconEl.textContent = mod.icon;
        const textBlock = document.createElement("div");
        textBlock.className = "ph-module-text";
        const nameEl = document.createElement("div");
        nameEl.className = "ph-mod-name";
        nameEl.textContent = mod.name;
        if (mod.description) nameEl.title = mod.description;
        const metaEl = document.createElement("div");
        metaEl.className = "ph-mod-meta";
        metaEl.textContent = mod.activation;
        textBlock.append(nameEl, metaEl);
        cardMain.append(iconEl, textBlock);
        const controls = document.createElement("div");
        controls.className = "ph-module-controls";
        if (AUTO_KINDS.includes(mod.activation)) {
          const indicator = document.createElement("span");
          indicator.className = "ph-indicator";
          indicator.classList.toggle("ph-active", activeState.get(mod.id) ?? false);
          indicators.set(mod.id, indicator);
          controls.appendChild(indicator);
        }
        if (mod.activation === "command") {
          const btn = document.createElement("button");
          btn.className = "ph-btn-run";
          btn.type = "button";
          btn.textContent = "Run";
          btn.addEventListener("click", () => callbacks.onRun(mod.id));
          controls.appendChild(btn);
        }
        if (mod.activation === "toggle") {
          const btn = document.createElement("button");
          btn.className = "ph-btn-toggle";
          btn.type = "button";
          btn.textContent = activeState.get(mod.id) ? "Close" : "Open";
          btn.disabled = !(enabledState[mod.id] ?? true);
          btn.addEventListener("click", () => callbacks.onToggleOpen(mod.id));
          toggleBtns.set(mod.id, btn);
          controls.appendChild(btn);
        }
        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.className = "ph-toggle";
        toggle.title = "Enable module";
        toggle.checked = enabledState[mod.id] ?? true;
        toggle.addEventListener("change", () => {
          const enabled = toggle.checked;
          callbacks.onToggleEnable(mod.id, enabled);
          const openBtn = toggleBtns.get(mod.id);
          if (openBtn) {
            openBtn.disabled = !enabled;
            if (!enabled) openBtn.textContent = "Open";
          }
          if (!enabled) {
            activeState.set(mod.id, false);
            indicators.get(mod.id)?.classList.remove("ph-active");
            updateCategoryChrome();
          }
        });
        enableToggles.set(mod.id, toggle);
        controls.appendChild(toggle);
        card.append(cardMain, controls);
        content.appendChild(card);
      }
    };
    for (const cat of visibleCategories) {
      const btn = document.createElement("button");
      btn.className = "ph-category-tab";
      btn.type = "button";
      btn.addEventListener("click", () => {
        selectedCategory = cat;
        updateCategoryChrome();
        renderContent();
      });
      const label = document.createElement("span");
      label.className = "ph-category-label";
      label.textContent = CATEGORY_LABELS[cat];
      const badge = document.createElement("span");
      badge.className = "ph-category-badge";
      badge.textContent = "0";
      btn.append(label, badge);
      categoryBtns.set(cat, btn);
      categoryBadges.set(cat, badge);
      sidebar.appendChild(btn);
    }
    updateCategoryChrome();
    renderContent();
    document.body.appendChild(dock);
    return {
      setActive(id, active) {
        if (destroyed) return;
        activeState.set(id, active);
        indicators.get(id)?.classList.toggle("ph-active", active);
        const btn = toggleBtns.get(id);
        if (btn) btn.textContent = active ? "Close" : "Open";
        updateCategoryChrome();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        renderedModuleIds = [];
        activeState.clear();
        indicators.clear();
        toggleBtns.clear();
        enableToggles.clear();
        categoryBtns.clear();
        categoryBadges.clear();
        dock.replaceChildren();
        dock.remove();
      }
    };
  }

  // src/core/shell.ts
  var AUTO_KINDS2 = ["auto", "page", "background"];
  var enabledKey = (id) => `enabled:${id}`;
  var openKey = (id) => `open:${id}`;
  async function bootShell(registry, services, screen) {
    injectTheme();
    const storage = services.storage;
    const available = registry.available(screen);
    const enabledState = {};
    const openState = {};
    for (const mod of available) {
      const stored = await storage.get(enabledKey(mod.id));
      enabledState[mod.id] = stored ?? false;
      if (mod.activation === "toggle") {
        openState[mod.id] = await storage.get(openKey(mod.id)) ?? false;
      }
    }
    let dock = null;
    if (services.windows) {
      services.windows.onWindowClosed((id) => {
        openState[id] = false;
        void storage.set(openKey(id), false);
        registry.deactivate(id);
        dock?.setActive(id, false);
      });
    }
    const activateToggle = async (id) => {
      try {
        await registry.activate(id);
        const active = registry.isActive(id);
        openState[id] = active;
        await storage.set(openKey(id), active);
        dock?.setActive(id, active);
      } catch (err) {
        openState[id] = false;
        await storage.set(openKey(id), false);
        dock?.setActive(id, false);
        services.logger.error("Failed to open toggle module", id, err);
      }
    };
    for (const mod of available) {
      if (AUTO_KINDS2.includes(mod.activation) && enabledState[mod.id]) {
        void registry.activate(mod.id).then(() => {
          dock?.setActive(mod.id, registry.isActive(mod.id));
        });
      }
    }
    dock = createDock(available, enabledState, {
      async onToggleEnable(id, enabled) {
        enabledState[id] = enabled;
        await storage.set(enabledKey(id), enabled);
        const manifest4 = available.find((m) => m.id === id);
        if (!manifest4) return;
        if (AUTO_KINDS2.includes(manifest4.activation)) {
          if (enabled) {
            void registry.activate(id).then(() => dock?.setActive(id, registry.isActive(id)));
          } else {
            registry.deactivate(id);
            dock?.setActive(id, false);
          }
        } else if (manifest4.activation === "toggle" && !enabled && registry.isActive(id)) {
          openState[id] = false;
          await storage.set(openKey(id), false);
          registry.deactivate(id);
        }
      },
      async onRun(id) {
        await registry.activate(id);
        registry.deactivate(id);
      },
      async onToggleOpen(id) {
        if (registry.isActive(id)) {
          openState[id] = false;
          await storage.set(openKey(id), false);
          registry.deactivate(id);
        } else {
          await activateToggle(id);
        }
      }
    });
    for (const mod of available) {
      if (mod.activation === "toggle" && enabledState[mod.id] && openState[mod.id]) {
        void activateToggle(mod.id);
      }
    }
    const anchorEl = await waitForElement("new_quest", 3e3);
    if (anchorEl) {
      const launcher = document.createElement("div");
      launcher.id = "phantom-launcher";
      launcher.className = "quest";
      launcher.title = "Phantom";
      const launcherMark = document.createElement("img");
      launcherMark.className = "ph-launcher-mark";
      launcherMark.src = PHANTOM_MARK_DATA_URI;
      launcherMark.alt = "Phantom";
      launcher.appendChild(launcherMark);
      launcher.addEventListener("click", () => {
        document.getElementById("phantom-dock")?.classList.toggle("ph-hidden");
      });
      anchorEl.insertAdjacentElement("afterend", launcher);
    }
  }

  // src/modules/status-overview/manifest.ts
  var manifest = {
    id: "status-overview",
    name: "Status Overview",
    version: "0.1.0",
    category: "overview",
    activation: "auto",
    allowedScreens: ["overview" /* OVERVIEW */],
    icon: "\u{1F4CA}",
    description: "Village resources, population and storage at a glance"
  };

  // src/modules/status-overview/service.ts
  var READY_EVENT = "statusOverview:ready";
  function initService(context) {
    const gd = context.services.gameData.snapshot();
    if (!gd) return;
    const { village } = gd;
    const state = {
      resources: {
        wood: village.wood,
        stone: village.stone,
        iron: village.iron
      },
      storageMax: village.storage_max,
      population: { current: village.pop, max: village.pop_max },
      capturedAt: Date.now()
    };
    context.state.set("statusOverview", state);
    context.eventBus.emit(READY_EVENT, state);
  }

  // src/ui/panel.ts
  function createPanel(title, parent) {
    const wrapper = document.createElement("div");
    wrapper.className = "phantom-panel";
    const titleEl = document.createElement("div");
    titleEl.className = "phantom-panel-title";
    titleEl.textContent = title;
    const contentEl = document.createElement("div");
    contentEl.className = "phantom-panel-content";
    wrapper.append(titleEl, contentEl);
    parent.appendChild(wrapper);
    return {
      contentEl,
      destroy() {
        wrapper.remove();
      }
    };
  }

  // src/modules/status-overview/ui.ts
  function renderState(state, el) {
    el.replaceChildren();
    const row = (label, value) => {
      const d = document.createElement("div");
      const b = document.createElement("b");
      b.textContent = label + ": ";
      d.append(b, document.createTextNode(value));
      return d;
    };
    const { resources: r, storageMax, population: p } = state;
    const ts = new Date(state.capturedAt).toLocaleTimeString();
    el.append(
      row("Wood", `${r.wood.toLocaleString()} / ${storageMax.toLocaleString()}`),
      row("Stone", `${r.stone.toLocaleString()} / ${storageMax.toLocaleString()}`),
      row("Iron", `${r.iron.toLocaleString()} / ${storageMax.toLocaleString()}`),
      row("Pop", `${p.current} / ${p.max}`),
      row("As of", ts)
    );
  }
  async function initUi(context) {
    const state = context.state.get("statusOverview");
    if (!state) return { destroy: () => void 0 };
    const mountEl = await waitForElement("contentContainer", 5e3) ?? document.body;
    let panel = createPanel("Village Status", mountEl);
    renderState(state, panel.contentEl);
    const unsubscribe = context.eventBus.on(READY_EVENT, (s) => {
      if (panel) renderState(s, panel.contentEl);
    });
    return {
      destroy() {
        unsubscribe();
        panel?.destroy();
        panel = null;
      }
    };
  }

  // src/modules/status-overview/index.ts
  var cleanupUi = null;
  var statusOverviewModule = {
    manifest,
    async init(ctx) {
      initService(ctx);
      const ui = await initUi(ctx);
      cleanupUi = ui.destroy;
    },
    destroy() {
      cleanupUi?.();
      cleanupUi = null;
    }
  };
  var status_overview_default = statusOverviewModule;

  // src/modules/notas-manuais/manifest.ts
  var manifest2 = {
    id: "notas-manuais",
    name: "Notas Manuais",
    version: "1.0.0",
    category: "planning",
    activation: "toggle",
    allowedScreens: ["*"],
    // coordinate-based; works on any screen
    icon: "\u{1F4DD}",
    description: "Adiciona notas a aldeias por coordenadas"
  };

  // src/game/world-data.ts
  var cache = null;
  async function getVillageMap() {
    if (cache) return cache;
    const res = await fetch("/map/village.txt", { credentials: "same-origin" });
    if (!res.ok) throw new Error(`village.txt fetch failed: ${res.status}`);
    const text = await res.text();
    const map = /* @__PURE__ */ new Map();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed.split(",");
      if (parts.length < 5) continue;
      const [rawId, rawName, rawX, rawY, rawPlayer] = parts;
      const id = parseInt(rawId ?? "", 10);
      const x = parseInt(rawX ?? "", 10);
      const y = parseInt(rawY ?? "", 10);
      const playerId = parseInt(rawPlayer ?? "", 10);
      if (isNaN(id) || isNaN(x) || isNaN(y) || isNaN(playerId)) continue;
      const name = decodeURIComponent((rawName ?? "").replace(/\+/g, " "));
      const coord = `${x}|${y}`;
      map.set(coord, { id, name, x, y, playerId });
    }
    cache = map;
    return map;
  }

  // src/modules/notas-manuais/service.ts
  function parseCoords(text) {
    const normalized = text.replace(/(\d+)\s*[,]\s*(\d+)/g, "$1|$2");
    const matches = normalized.match(/\d{1,3}\|\d{1,3}/g) ?? [];
    return [...new Set(matches)];
  }
  async function simulate(coords) {
    const map = await getVillageMap();
    return coords.map((coord) => {
      const v = map.get(coord);
      return {
        coord,
        villageId: v?.id ?? null,
        villageName: v?.name ?? null,
        playerId: v?.playerId ?? null,
        matched: v !== void 0
      };
    });
  }
  async function sendNotes(coords, note, villageId, request, stopRef, onProgress) {
    const map = await getVillageMap();
    const matched = coords.map((c) => ({ coord: c, record: map.get(c) })).filter((e) => e.record);
    const total = matched.length;
    for (let i = 0; i < matched.length; i++) {
      if (stopRef.stop) {
        onProgress({ text: "Parado pelo utilizador.", level: "info" }, i, total);
        return;
      }
      const { coord, record } = matched[i];
      try {
        const res = await request.editVillageNote(villageId, String(record.id), note);
        let success = res.ok;
        if (success) {
          try {
            const text = await res.clone().text();
            if (text.trim().startsWith("{")) {
              const json = JSON.parse(text);
              if (json.error) success = false;
            }
          } catch {
          }
        }
        onProgress(
          {
            text: success ? `\u2713 ${coord} \u2014 ${record.name}` : `\u2717 ${coord} \u2014 erro HTTP ${res.status}`,
            level: success ? "ok" : "err"
          },
          i + 1,
          total
        );
      } catch (e) {
        onProgress(
          { text: `\u2717 ${coord} \u2014 ${e instanceof Error ? e.message : "erro"}`, level: "err" },
          i + 1,
          total
        );
      }
      if (i < matched.length - 1 && !stopRef.stop) {
        await delay(300 + Math.random() * 200);
      }
    }
  }
  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // src/modules/notas-manuais/ui.ts
  var PRESETS = [
    { label: "ATAQUE", value: "[b][size=20][color=#cc0000]ATAQUE[/color][/size][/b]" },
    { label: "DEFESA", value: "[b][size=20][color=#1f7a1f]DEFESA[/color][/size][/b]" },
    { label: "POSS\xCDVEL ATAQUE", value: "[b][size=20][color=#e07b00]POSS\xCDVEL ATAQUE[/color][/size][/b]" },
    { label: "POSS\xCDVEL DEFESA", value: "[b][size=20][color=#1d5fb3]POSS\xCDVEL DEFESA[/color][/size][/b]" }
  ];
  var STORAGE_COORDS = "notas-manuais:coords";
  var STORAGE_NOTE = "notas-manuais:note";
  var STORAGE_PRESET = "notas-manuais:preset";
  async function initUi2(ctx, contentEl) {
    const storage = ctx.services.storage;
    const request = ctx.services.request;
    const gd = ctx.services.gameData.snapshot();
    const [savedCoords, savedNote, savedPreset] = await Promise.all([
      storage.get(STORAGE_COORDS),
      storage.get(STORAGE_NOTE),
      storage.get(STORAGE_PRESET)
    ]);
    const root = document.createElement("div");
    const coordsSection = makeSection("Coordenadas");
    const coordsTA = makeTextarea("xxx|yyy \u2014 uma por linha, ou separadas por espa\xE7o", 5);
    coordsTA.value = savedCoords ?? "";
    coordsSection.appendChild(coordsTA);
    root.appendChild(coordsSection);
    const presetsRow = document.createElement("div");
    presetsRow.className = "ph-nm-presets";
    for (const preset of PRESETS) {
      const btn = document.createElement("button");
      btn.className = "ph-nm-preset";
      btn.textContent = preset.label;
      btn.addEventListener("click", () => {
        noteTA.value = preset.value;
        void storage.set(STORAGE_PRESET, preset.value);
        void storage.set(STORAGE_NOTE, preset.value);
      });
      presetsRow.appendChild(btn);
    }
    root.appendChild(presetsRow);
    const noteSection = makeSection("Nota");
    const noteTA = makeTextarea("Texto da nota", 3);
    noteTA.value = savedNote ?? savedPreset ?? "";
    noteSection.appendChild(noteTA);
    root.appendChild(noteSection);
    coordsTA.addEventListener("input", () => void storage.set(STORAGE_COORDS, coordsTA.value));
    noteTA.addEventListener("input", () => void storage.set(STORAGE_NOTE, noteTA.value));
    const actionsRow = document.createElement("div");
    actionsRow.className = "ph-nm-actions";
    const btnSimular = makeBtn("Simular");
    const btnIniciar = makeBtn("Iniciar");
    const btnParar = makeBtn("Parar", "ph-nm-btn ph-nm-btn-stop");
    btnParar.disabled = true;
    actionsRow.append(btnSimular, btnIniciar, btnParar);
    root.appendChild(actionsRow);
    const progressWrap = document.createElement("div");
    const progressTrack = document.createElement("div");
    progressTrack.className = "ph-nm-progress-track";
    const progressFill = document.createElement("div");
    progressFill.className = "ph-nm-progress-fill";
    const progressText = document.createElement("div");
    progressText.className = "ph-nm-progress-text";
    progressTrack.appendChild(progressFill);
    progressWrap.append(progressTrack, progressText);
    progressWrap.style.display = "none";
    root.appendChild(progressWrap);
    const logEl = document.createElement("div");
    logEl.className = "ph-nm-log";
    logEl.style.display = "none";
    root.appendChild(logEl);
    contentEl.appendChild(root);
    const stopRef = { stop: false };
    let running = false;
    function setRunning(val) {
      running = val;
      btnIniciar.disabled = val;
      btnSimular.disabled = val;
      btnParar.disabled = !val;
      if (val) {
        logEl.style.display = "";
        progressWrap.style.display = "";
      }
    }
    function appendLog(entry) {
      const line = document.createElement("p");
      line.className = `ph-nm-log-line ${entry.level}`;
      line.textContent = entry.text;
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
    }
    function setProgress(done, total) {
      const pct = total > 0 ? Math.round(done / total * 100) : 0;
      progressFill.style.width = `${pct}%`;
      progressText.textContent = `${done} / ${total}`;
    }
    btnSimular.addEventListener("click", async () => {
      const coords = parseCoords(coordsTA.value);
      if (coords.length === 0) {
        appendLog({ text: "Sem coordenadas v\xE1lidas.", level: "info" });
        return;
      }
      setRunning(true);
      logEl.innerHTML = "";
      appendLog({ text: `A resolver ${coords.length} coordenada(s)...`, level: "info" });
      try {
        const results = await simulate(coords);
        const matched = results.filter((r) => r.matched);
        appendLog({ text: `${matched.length} de ${coords.length} encontradas.`, level: "info" });
        for (const r of results) {
          appendLog({
            text: r.matched ? `  ${r.coord} \u2192 ${r.villageName} (id ${r.villageId})` : `  ${r.coord} \u2192 n\xE3o encontrada`,
            level: r.matched ? "ok" : "err"
          });
        }
      } catch (e) {
        appendLog({ text: `Erro: ${e instanceof Error ? e.message : String(e)}`, level: "err" });
      } finally {
        setRunning(false);
      }
    });
    btnIniciar.addEventListener("click", async () => {
      const coords = parseCoords(coordsTA.value);
      const note = noteTA.value.trim();
      if (coords.length === 0) {
        appendLog({ text: "Sem coordenadas v\xE1lidas.", level: "info" });
        return;
      }
      if (!note) {
        appendLog({ text: "A nota n\xE3o pode estar vazia.", level: "info" });
        return;
      }
      if (!gd?.village.id) {
        appendLog({ text: "game_data n\xE3o dispon\xEDvel.", level: "err" });
        return;
      }
      const { matched } = await simulate(coords).then((rs) => ({ matched: rs.filter((r) => r.matched) }));
      const confirmed = window.confirm(
        `Confirmar: escrever "${note}" em ${matched.length} aldeia(s)?
Aten\xE7\xE3o: substitui as notas existentes.`
      );
      if (!confirmed) return;
      setRunning(true);
      stopRef.stop = false;
      logEl.innerHTML = "";
      setProgress(0, matched.length);
      await sendNotes(
        coords,
        note,
        String(gd.village.id),
        request,
        stopRef,
        (entry, done, total) => {
          appendLog(entry);
          setProgress(done, total);
        }
      );
      setRunning(false);
    });
    btnParar.addEventListener("click", () => {
      stopRef.stop = true;
    });
    return {
      destroy() {
        root.remove();
      }
    };
  }
  function makeSection(label) {
    const section = document.createElement("div");
    section.className = "ph-nm-section";
    const lbl = document.createElement("label");
    lbl.className = "ph-nm-label";
    lbl.textContent = label;
    section.appendChild(lbl);
    return section;
  }
  function makeTextarea(placeholder, rows) {
    const ta = document.createElement("textarea");
    ta.className = "ph-nm-textarea";
    ta.placeholder = placeholder;
    ta.rows = rows;
    return ta;
  }
  function makeBtn(label, className = "ph-nm-btn") {
    const btn = document.createElement("button");
    btn.className = className;
    btn.textContent = label;
    return btn;
  }

  // src/modules/notas-manuais/index.ts
  var windowHandle = null;
  var cleanupUi2 = null;
  var notasManuaisModule = {
    manifest: manifest2,
    async init(ctx) {
      windowHandle = ctx.services.windows.open({
        moduleId: manifest2.id,
        title: "Notas Manuais por Coordenadas",
        defaultSize: { w: 480, h: 520 },
        defaultPos: { x: 200, y: 80 }
      });
      const ui = await initUi2(ctx, windowHandle.contentEl);
      cleanupUi2 = ui.destroy;
    },
    destroy() {
      cleanupUi2?.();
      cleanupUi2 = null;
      windowHandle?.close();
      windowHandle = null;
    }
  };
  var notas_manuais_default = notasManuaisModule;

  // src/modules/renomear-cores/manifest.ts
  var manifest3 = {
    id: "renomear-cores",
    name: "Renomear a Cores",
    version: "1.0.0",
    category: "attack-defense",
    activation: "page",
    allowedScreens: [
      "overview" /* OVERVIEW */,
      "overview_villages" /* OVERVIEW_VILLAGES */,
      "info_village" /* INFO_VILLAGE */,
      "place" /* PLACE */
    ],
    icon: "\u{1F3A8}",
    description: "Bot\xF5es de renomea\xE7\xE3o r\xE1pida com cores nos ataques recebidos"
  };

  // src/modules/renomear-cores/constants.ts
  var SETTINGS_TAGS = [
    "[Morto]",
    "[Desviado]",
    "[Desviar]",
    "[Reconquistar]",
    "[Reconquistado]",
    "[Snipado]",
    "[Snipar]",
    "[Fubar]",
    "[Fubado]",
    "[Snipe Cancel]",
    "[Aten\xE7\xE3o]",
    "[RIP]",
    "[Fake]",
    "[Rezar]",
    "[Refor\xE7ar]",
    " | Retirar tropas",
    " | Vigiar",
    " | \u2713"
  ];
  var SETTINGS_LABELS = [
    "M",
    "D!",
    "D",
    "R",
    "RR",
    "S!",
    "S",
    "FU",
    "FUB",
    "SC",
    "Att",
    "RIP",
    "FK",
    "RZ",
    "RF",
    "R!",
    "V!",
    "\u2713"
  ];
  var SETTINGS_COLORS = [
    "green",
    "orange",
    "dorange",
    "gray",
    "green",
    "green",
    "blue",
    "dgreen",
    "green",
    "red",
    "Pink",
    "dblue",
    "green",
    "dblue",
    "black",
    "dgreen",
    "yellow",
    "lgreen"
  ];
  var SETTINGS_TEXT = [
    "white",
    "white",
    "white",
    "white",
    "white",
    "white",
    "white",
    "white",
    "white",
    "white",
    "black",
    "white",
    "white",
    "white",
    "white",
    "white",
    "black",
    "black"
  ];
  var COLOR_NAMES = [
    "red",
    "green",
    "blue",
    "yellow",
    "orange",
    "lblue",
    "lime",
    "white",
    "black",
    "gray",
    "dorange",
    "black",
    "Pink",
    "brown",
    "dblue",
    "dgreen",
    "lgreen"
  ];
  var COLOR_TOP = [
    "#e20606",
    "#31c908",
    "#0d83dd",
    "#ffd91c",
    "#ef8b10",
    "#22e5db",
    "#ffd400",
    "#ffffff",
    "#000000",
    "#adb6c6",
    "#9232a8",
    "#40434E",
    "#FFC0CB",
    "#892929",
    "#00007f",
    "#004c00",
    "#93cf82"
  ];
  var COLOR_BOT = [
    "#ff0000",
    "#228c05",
    "#0860a3",
    "#e8c30d",
    "#d3790a",
    "#0cd3c9",
    "#ffd400",
    "#dbdbdb",
    "#000000",
    "#828891",
    "#9232a8",
    "#40434E",
    "#FFC0CB",
    "#892929",
    "#00007f",
    "#004c00",
    "#93cf82"
  ];
  var NOTE_COLORS = { ataque: "red", defesa: "lblue" };
  var DEFAULT_COLORING_MODE = "coluna";
  var FONT_SIZE = 8;

  // src/modules/renomear-cores/service.ts
  function buildPresets() {
    return SETTINGS_TAGS.map((tag, i) => ({
      tag,
      label: SETTINGS_LABELS[i] ?? "",
      colorName: SETTINGS_COLORS[i] ?? "white",
      textColorName: SETTINGS_TEXT[i] ?? "black",
      isAppend: tag.includes("|")
    }));
  }
  function getTopColor(name) {
    const i = COLOR_NAMES.indexOf(name);
    return i === -1 ? name : COLOR_TOP[i] ?? name;
  }
  function getBotColor(name) {
    const i = COLOR_NAMES.indexOf(name);
    return i === -1 ? name : COLOR_BOT[i] ?? name;
  }
  function getCommandName(row) {
    const el = row.querySelector(
      ".quickedit-content, .quickedit-name, .rename-content, .rename-name"
    );
    return el?.textContent?.trim() ?? "";
  }
  function getNewName(currentName, tag, isAppend) {
    if (isAppend) return currentName + tag;
    return (currentName.split(" ")[0] ?? "") + " " + tag;
  }
  function checkDualTag(name) {
    for (let i = 0; i < SETTINGS_TAGS.length; i++) {
      for (let j = 0; j < SETTINGS_TAGS.length; j++) {
        if (name.includes(SETTINGS_TAGS[i] + SETTINGS_TAGS[j])) {
          return {
            color1: getBotColor(SETTINGS_COLORS[i]),
            color2: getBotColor(SETTINGS_COLORS[j])
          };
        }
      }
    }
    return null;
  }
  function findTagIndex(name) {
    for (let i = 0; i < SETTINGS_TAGS.length; i++) {
      if (name.includes(SETTINGS_TAGS[i])) return i;
    }
    return -1;
  }
  function isSupport(row) {
    const img = row.querySelector("img");
    return img !== null && img.src.includes("support");
  }
  function applyRowColor(row, mode, bgColor, textColor) {
    if (mode === "nada") return;
    if (mode === "coluna") {
      const firstTd = row.querySelector("td");
      if (!firstTd) return;
      firstTd.style.backgroundColor = bgColor;
      const link = firstTd.querySelector("a");
      if (link) link.style.color = textColor;
    } else {
      row.querySelectorAll("td").forEach((td) => {
        td.style.backgroundColor = bgColor;
      });
    }
  }
  function applyDualTagColor(row, mode, color1, color2) {
    if (mode === "nada") return;
    const gradient = `repeating-linear-gradient(45deg,${color1},${color1} 10px,${color2} 10px,${color2} 20px)`;
    if (mode === "coluna") {
      const firstTd = row.querySelector("td");
      if (firstTd) firstTd.style.background = gradient;
    } else {
      row.querySelectorAll("td").forEach((td) => {
        td.style.background = gradient;
      });
    }
  }
  function colorByVillageNote(row, mode) {
    if (mode === "nada") return;
    const imgs = row.querySelectorAll("img");
    for (const img of Array.from(imgs)) {
      if (!img.classList.contains("icon_village_notes") && !img.dataset.title && !img.hasAttribute("title")) continue;
      const txt = (img.dataset.title ?? img.getAttribute("title") ?? "").toLowerCase();
      if (!txt) continue;
      let colorName = null;
      if (txt.includes("ataque") || txt.includes("ofensiv")) colorName = NOTE_COLORS.ataque;
      else if (txt.includes("defesa") || txt.includes("defensiv")) colorName = NOTE_COLORS.defesa;
      if (!colorName) continue;
      const td = img.closest("td");
      if (td) td.style.backgroundColor = getBotColor(colorName);
      break;
    }
  }
  function renameCommand(row, newName, onDone) {
    const renameIcon = row.querySelector(".rename-icon");
    if (renameIcon) {
      _renameViaIcon(renameIcon, row, newName, onDone);
      return;
    }
    const pencil = row.querySelector(".quickedit-pencil");
    if (!pencil) {
      onDone?.();
      return;
    }
    _renameViaPencil(pencil, row, newName, onDone);
  }
  function _renameViaIcon(icon, row, newName, onDone) {
    const observer = new MutationObserver(() => {
      const input = row.querySelector('input[type="text"]');
      if (!input) return;
      observer.disconnect();
      clearTimeout(timeout);
      input.value = newName;
      const submit = row.querySelector('input[type="button"]');
      if (submit) {
        submit.click();
      } else {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
      }
      onDone?.();
    });
    observer.observe(row, { childList: true, subtree: true });
    const timeout = setTimeout(() => {
      observer.disconnect();
      onDone?.();
    }, 2e3);
    icon.click();
  }
  function _renameViaPencil(pencil, row, newName, onDone) {
    const cell = pencil.closest("td") ?? row;
    const observer = new MutationObserver(() => {
      const input = cell.querySelector('.quickedit-input, input[type="text"]');
      if (!input) return;
      observer.disconnect();
      clearTimeout(timeout);
      input.value = newName;
      const save = cell.querySelector(".quickedit-save");
      if (save) {
        save.click();
      } else {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
      }
      onDone?.();
    });
    observer.observe(cell, { childList: true, subtree: true });
    const timeout = setTimeout(() => {
      observer.disconnect();
      onDone?.();
    }, 2e3);
    pencil.click();
  }

  // src/modules/renomear-cores/ui.ts
  var PROCESSED_ATTR = "data-ph-rc";
  var BUSY_ATTR = "data-ph-rc-busy";
  var PRESETS2 = buildPresets();
  function findRenameCell(row) {
    for (const td of Array.from(row.querySelectorAll("td"))) {
      if (td.querySelector(".quickedit, .rename-icon, .quickedit-pencil")) return td;
    }
    return null;
  }
  function clearRowColor(row) {
    row.querySelectorAll("td").forEach((td) => {
      td.style.backgroundColor = "";
      td.style.background = "";
    });
    const link = row.querySelector("td:first-child a");
    if (link) link.style.color = "";
  }
  function processRow(row, mode) {
    if (row.hasAttribute(PROCESSED_ATTR)) return;
    const tds = row.querySelectorAll("td");
    if (tds.length === 0) return;
    const name = getCommandName(row);
    const dual = checkDualTag(name);
    if (dual) {
      applyDualTagColor(row, mode, dual.color1, dual.color2);
    } else {
      const tagIdx = findTagIndex(name);
      if (tagIdx >= 0) {
        applyRowColor(row, mode, getBotColor(SETTINGS_COLORS[tagIdx]), getTopColor(SETTINGS_TEXT[tagIdx]));
      } else if (isSupport(row)) {
        applyRowColor(row, mode, getBotColor("yellow"), "#000000");
      } else {
        applyRowColor(row, mode, getBotColor("red"), "#ffffff");
      }
    }
    colorByVillageNote(row, mode);
    const targetCell = findRenameCell(row);
    if (!targetCell) {
      row.setAttribute(PROCESSED_ATTR, "1");
      return;
    }
    const group = document.createElement("span");
    group.className = "ph-rc-group";
    group.style.fontSize = `${FONT_SIZE}pt`;
    for (let i = 0; i < PRESETS2.length; i++) {
      const preset = PRESETS2[i];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ph-rc-btn";
      btn.textContent = preset.label;
      btn.style.backgroundColor = getBotColor(preset.colorName);
      btn.style.color = getTopColor(preset.textColorName);
      btn.title = preset.tag;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (row.hasAttribute(BUSY_ATTR)) return;
        row.setAttribute(BUSY_ATTR, "1");
        const currentName = getCommandName(row);
        const newName = getNewName(currentName, preset.tag, preset.isAppend);
        renameCommand(row, newName, () => {
          row.removeAttribute(BUSY_ATTR);
          row.removeAttribute(PROCESSED_ATTR);
          row.querySelector(".ph-rc-group")?.remove();
          clearRowColor(row);
        });
      });
      group.appendChild(btn);
    }
    row.setAttribute(PROCESSED_ATTR, "1");
    targetCell.appendChild(group);
  }
  function processAll(table, mode) {
    table.querySelectorAll("tr").forEach((row) => processRow(row, mode));
  }
  function addMassButtons(th, table, mode) {
    if (th.querySelector(".ph-rc-mass-group")) return;
    const group = document.createElement("span");
    group.className = "ph-rc-group ph-rc-mass-group";
    group.style.fontSize = `${FONT_SIZE}pt`;
    for (let i = 0; i < PRESETS2.length; i++) {
      const preset = PRESETS2[i];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ph-rc-btn";
      btn.textContent = preset.label;
      btn.style.backgroundColor = getBotColor(preset.colorName);
      btn.style.color = getTopColor(preset.textColorName);
      btn.title = `Renomear selecionados: ${preset.tag}`;
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rows = Array.from(
          table.querySelectorAll('input[type="checkbox"]:checked')
        ).map((cb) => cb.closest("tr")).filter((r) => r !== null);
        for (let j = 0; j < rows.length; j++) {
          const row = rows[j];
          if (row.hasAttribute(BUSY_ATTR)) continue;
          row.setAttribute(BUSY_ATTR, "1");
          const currentName = getCommandName(row);
          const newName = getNewName(currentName, preset.tag, preset.isAppend);
          row.removeAttribute(PROCESSED_ATTR);
          row.querySelector(".ph-rc-group")?.remove();
          clearRowColor(row);
          renameCommand(row, newName, () => {
            row.removeAttribute(BUSY_ATTR);
          });
          if (j < rows.length - 1) await delay2(200);
        }
      });
      group.appendChild(btn);
    }
    th.appendChild(group);
  }
  function findSelectAllTh(table) {
    const bar = document.getElementById("ignored_commands_bar");
    if (bar) {
      const th = bar.querySelector("th");
      if (th) return th;
    }
    for (const th of Array.from(table.querySelectorAll("th"))) {
      if (th.querySelector("input.selectAll")) return th;
    }
    return null;
  }
  function delay2(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function initUi3(table, mode = DEFAULT_COLORING_MODE) {
    processAll(table, mode);
    const selectAllTh = findSelectAllTh(table);
    if (selectAllTh) addMassButtons(selectAllTh, table, mode);
    let debounce = null;
    let processing = false;
    const observer = new MutationObserver((mutations) => {
      if (processing) return;
      if (!mutations.some((m) => m.addedNodes.length > 0)) return;
      if (debounce !== null) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        processing = true;
        try {
          processAll(table, mode);
          if (selectAllTh) addMassButtons(selectAllTh, table, mode);
        } finally {
          processing = false;
        }
      }, 80);
    });
    observer.observe(table, { childList: true, subtree: true });
    return function destroy() {
      observer.disconnect();
      if (debounce !== null) {
        clearTimeout(debounce);
        debounce = null;
      }
      table.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach((row) => {
        row.removeAttribute(PROCESSED_ATTR);
        row.removeAttribute(BUSY_ATTR);
        clearRowColor(row);
        row.querySelectorAll(".ph-rc-group").forEach((g) => g.remove());
      });
      document.querySelectorAll(".ph-rc-mass-group").forEach((g) => g.remove());
    };
  }

  // src/modules/renomear-cores/index.ts
  var destroyUi = null;
  var renomearCoresModule = {
    manifest: manifest3,
    init(ctx) {
      const table = document.getElementById("incomings_table");
      if (!table) {
        ctx.services.logger.info("incomings_table not found on this screen \u2014 skipping");
        return;
      }
      destroyUi = initUi3(table);
    },
    destroy() {
      destroyUi?.();
      destroyUi = null;
    }
  };
  var renomear_cores_default = renomearCoresModule;

  // src/bootstrap.ts
  async function boot() {
    const gameData = createGameDataService();
    const gd = gameData.snapshot();
    if (!gd) return;
    const state = createStateStore();
    const eventBus = createEventBus();
    const storage = createStorageService();
    const services = {
      gameData,
      logger: createLogger(),
      storage,
      windows: createWindowManager(storage),
      request: createRequestService(gameData)
    };
    const registry = createRegistry({ state, eventBus, services });
    registry.register(status_overview_default);
    registry.register(notas_manuais_default);
    registry.register(renomear_cores_default);
    await bootShell(registry, services, gd.screen);
  }
  void boot();
})();
