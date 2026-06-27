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
    const gd = JSON.parse(JSON.stringify(raw));
    const rawSitter = gd.player.sitter;
    gd.player.sitter = rawSitter ? parseInt(String(rawSitter), 10) || 0 : 0;
    return gd;
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
    function buildContext(module, hubContent) {
      return {
        state: shared.state,
        eventBus: shared.eventBus,
        services: {
          ...shared.services,
          // Each module gets a logger scoped to its own id
          logger: shared.services.logger.scoped(module.manifest.id)
        },
        manifest: module.manifest,
        hubContent
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
      async activate(id, hubContent) {
        const module = modules.get(id);
        if (!module) return;
        if (active.has(id)) {
          if (hubContent) await module.init(buildContext(module, hubContent));
          return;
        }
        if (pending.has(id)) return;
        pending.add(id);
        try {
          await module.init(buildContext(module, hubContent));
          if (hubContent && module.manifest.activation === "background") return;
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
      disposeUi(id) {
        modules.get(id)?.disposeUi?.();
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
    function sitterParam(gd) {
      return gd.player.sitter > 0 ? gd.player.id : void 0;
    }
    function buildUrl(opts) {
      const gd = gameData.snapshot();
      const village = opts.village ?? gd?.village.id ?? "";
      const csrf = gd?.csrf ?? "";
      const t = gd ? sitterParam(gd) : void 0;
      const url = new URL("/game.php", window.location.origin);
      url.searchParams.set("village", String(village));
      url.searchParams.set("screen", opts.screen);
      url.searchParams.set("action", opts.action);
      url.searchParams.set("h", csrf);
      url.searchParams.set("ajax", "1");
      if (t) url.searchParams.set("t", t);
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
        const t = gd ? sitterParam(gd) : void 0;
        const url = new URL("/game.php", window.location.origin);
        url.searchParams.set("village", currentVillageId);
        url.searchParams.set("screen", "info_village");
        url.searchParams.set("id", targetVillageId);
        url.searchParams.set("ajaxaction", "edit_notes");
        url.searchParams.set("h", csrf);
        if (t) url.searchParams.set("t", t);
        return fetch(url.toString(), {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ note })
        });
      },
      twPost(screen, params, data) {
        return new Promise((resolve, reject) => {
          TribalWars.post(screen, params, data, resolve, reject);
        });
      }
    };
  }

  // src/services/scheduler.ts
  function createSchedulerService(storage) {
    const timers = /* @__PURE__ */ new Map();
    const nextRunAt = /* @__PURE__ */ new Map();
    function storageKey(id) {
      return `scheduler:next:${id}`;
    }
    async function schedule(task) {
      const stored = await storage.get(storageKey(task.id));
      const now = Date.now();
      const next = stored ?? now;
      if (now >= next) {
        await execute(task);
      } else {
        const delay4 = next - now;
        nextRunAt.set(task.id, next);
        const timer = setTimeout(() => void execute(task), delay4);
        timers.set(task.id, timer);
      }
    }
    async function execute(task) {
      clearTimer(task.id);
      let shouldContinue = true;
      try {
        shouldContinue = await task.run();
      } finally {
        if (shouldContinue === false) return;
        const next = Date.now() + task.interval;
        nextRunAt.set(task.id, next);
        await storage.set(storageKey(task.id), next);
        const timer = setTimeout(() => void execute(task), task.interval);
        timers.set(task.id, timer);
      }
    }
    function clearTimer(id) {
      const t = timers.get(id);
      if (t !== void 0) {
        clearTimeout(t);
        timers.delete(id);
      }
      nextRunAt.delete(id);
    }
    return {
      register: schedule,
      async unregister(id) {
        clearTimer(id);
        await storage.remove(storageKey(id));
      },
      getRemaining(id) {
        const next = nextRunAt.get(id);
        if (next === void 0) return 0;
        return Math.max(0, next - Date.now());
      }
    };
  }

  // src/services/world-config.ts
  var STORAGE_KEY_PREFIX = "world-config:";
  var CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
  function parseXml(xml) {
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    const get = (tag) => doc.querySelector(tag)?.textContent ?? "0";
    return {
      speed: parseFloat(get("speed")) || 1,
      unit_speed: parseFloat(get("unit_speed")) || 1,
      moral: parseInt(get("moral"), 10) || 0,
      scavenging: get("scavenging") === "1"
    };
  }
  function createWorldConfigService(gameData, storage) {
    let cached = null;
    return {
      async get() {
        if (cached) return cached;
        const world = gameData.snapshot()?.world;
        if (!world) throw new Error("WorldConfigService: no game_data.world available");
        const cacheKey = `${STORAGE_KEY_PREFIX}${world}`;
        const stored = await storage.get(cacheKey);
        if (stored && Date.now() < stored.expiresAt) {
          cached = stored.config;
          return cached;
        }
        const host = window.location.hostname;
        const url = `https://${host}/interface.php?func=get_config`;
        const res = await fetch(url, { credentials: "omit" });
        if (!res.ok) throw new Error(`WorldConfigService: fetch failed (${res.status})`);
        const xml = await res.text();
        cached = parseXml(xml);
        await storage.set(cacheKey, { config: cached, expiresAt: Date.now() + CACHE_TTL_MS });
        return cached;
      }
    };
  }

  // src/services/keep-alive.ts
  function createKeepAliveService(logger) {
    const holders = /* @__PURE__ */ new Set();
    let audio = null;
    let resumeArmed = false;
    function startAntiFreeze() {
      if (audio) return;
      try {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) throw new Error("AudioContext unavailable");
        const ctx = new AudioCtor();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        audio = { ctx, osc, gain };
        logger.info("[AutoResSender] Anti-freeze audio iniciado");
        void resumeOrArm();
      } catch (e) {
        logger.warn("Anti-freeze audio falhou:", e);
      }
    }
    async function resumeOrArm() {
      if (!audio || audio.ctx.state !== "suspended") return;
      try {
        await audio.ctx.resume();
      } catch (e) {
        logger.warn("Anti-freeze audio resume falhou:", e);
      }
      if (audio.ctx.state === "suspended") armGestureResume();
    }
    function armGestureResume() {
      if (resumeArmed) return;
      resumeArmed = true;
      const resume = () => {
        resumeArmed = false;
        window.removeEventListener("pointerdown", resume, true);
        window.removeEventListener("keydown", resume, true);
        void resumeOrArm();
      };
      window.addEventListener("pointerdown", resume, { once: true, capture: true });
      window.addEventListener("keydown", resume, { once: true, capture: true });
    }
    function stopAntiFreeze() {
      const current = audio;
      if (!current) return;
      audio = null;
      try {
        current.osc.stop();
      } catch {
      }
      current.osc.disconnect();
      current.gain.disconnect();
      void current.ctx.close().catch((e) => logger.warn("Anti-freeze audio close falhou:", e));
    }
    return {
      acquire(moduleId) {
        holders.add(moduleId);
        startAntiFreeze();
      },
      release(moduleId) {
        holders.delete(moduleId);
        if (holders.size === 0) stopAntiFreeze();
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
      /* Parchment palette \u2014 validated in mockups */
      --ph-bg:          #ece0c0;
      --ph-sidebar:     #e3d3ac;
      --ph-surface:     #f5edd6;
      --ph-surface-alt: #e8dcbb;
      --ph-header:      #c1a264;
      --ph-on-header:   #3e2606;
      --ph-border:      #b9985f;
      --ph-border-soft: #cdb583;
      --ph-text:        #4a3617;
      --ph-text-2:      #7a6038;
      --ph-text-dim:    #9a855f;
      --ph-sel-bg:      #c1a264;
      --ph-sel-text:    #3e2606;
      --ph-green:       #5a8c3a;
      --ph-green-text:  #3b6d11;
      --ph-icon:        #8a5a1e;

      /* Activity monitor status pills */
      --ph-status-running:    #5a8c3a;
      --ph-status-waiting:    #c87c1a;
      --ph-status-scheduled:  #4a72a0;

      /* Backward-compat aliases for module CSS (ph-nm-*, ph-rc-*) */
      --ph-gold:             #c1a264;
      --ph-gold-light:       #d4aa70;
      --ph-bg-light:         #f0e5c8;
      --ph-panel-bg:         var(--ph-bg);
      --ph-panel-bg-image:   none;
      --ph-panel-header-bg:  var(--ph-header);
      --ph-panel-border:     var(--ph-border);
      --ph-panel-accent:     var(--ph-header);

      /* Layout */
      --ph-radius:           4px;
      --ph-brand-radius:     3px;
      --ph-launcher-mark-size: 25px;
      --ph-header-mark-size:   26px;
      --ph-z-strip:    2147482000;
      --ph-z-overlay:  2147482500;
      --ph-z-root:     2147483000;
    }

    /* --- Launcher (quest-bar anchor) --- */
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
      color: var(--ph-header);
      z-index: var(--ph-z-strip);
      user-select: none;
      box-sizing: border-box;
      overflow: hidden;
    }
    #phantom-launcher:hover { border-color: var(--ph-icon); }
    .ph-launcher-mark {
      width: var(--ph-launcher-mark-size);
      height: var(--ph-launcher-mark-size);
      border-radius: var(--ph-brand-radius);
      object-fit: cover;
      display: block;
      pointer-events: none;
    }

    /* ===== HUB MODAL ===== */

    #phantom-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      z-index: var(--ph-z-overlay);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #phantom-overlay.ph-hidden { display: none; }

    #phantom-hub {
      width: min(960px, 80vw);
      height: min(720px, 85vh);
      min-width: min(760px, calc(100vw - 24px));
      min-height: min(600px, calc(100vh - 24px));
      background: var(--ph-bg);
      border: 2px solid var(--ph-border);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 8px 40px rgba(0,0,0,0.45);
      font-family: Verdana, sans-serif;
      font-size: 11px;
      color: var(--ph-text);
    }

    .ph-hub-header {
      background: var(--ph-header);
      color: var(--ph-on-header);
      min-height: 44px;
      padding: 7px 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
      border-bottom: 2px solid var(--ph-border);
      user-select: none;
    }

    .ph-hub-brand {
      width: 28px;
      height: 28px;
      border-radius: var(--ph-brand-radius);
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.12);
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

    .ph-hub-titleblock { min-width: 0; flex: 1; }
    .ph-hub-title {
      font-weight: bold;
      font-size: 13px;
      color: var(--ph-on-header);
      line-height: 15px;
    }
    .ph-hub-version {
      font-size: 9px;
      color: rgba(62,38,6,0.7);
      line-height: 12px;
    }

    .ph-hub-close {
      width: 24px;
      height: 24px;
      border: 1px solid rgba(62,38,6,0.3);
      border-radius: var(--ph-radius);
      background: rgba(0,0,0,0.1);
      color: var(--ph-on-header);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      line-height: 1;
      flex-shrink: 0;
    }
    .ph-hub-close:hover { background: rgba(0,0,0,0.25); }

    .ph-hub-body {
      display: grid;
      grid-template-columns: 180px minmax(0, 1fr);
      min-height: 0;
      flex: 1;
      overflow: hidden;
    }

    /* --- Sidebar --- */
    .ph-hub-sidebar {
      background: var(--ph-sidebar);
      border-right: 1px solid var(--ph-border);
      padding: 6px 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
    .ph-hub-sidebar::-webkit-scrollbar { width: 3px; }
    .ph-hub-sidebar::-webkit-scrollbar-track { background: var(--ph-sidebar); }
    .ph-hub-sidebar::-webkit-scrollbar-thumb { background: var(--ph-border-soft); border-radius: 2px; }

    .ph-nav-item {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 7px 10px;
      cursor: pointer;
      color: var(--ph-text-2);
      border-left: 3px solid transparent;
      font-size: 11px;
      user-select: none;
      transition: background 0.1s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ph-nav-item:hover {
      background: rgba(193,162,100,0.18);
      color: var(--ph-text);
    }
    .ph-nav-item.ph-sel {
      background: rgba(193,162,100,0.28);
      border-left-color: var(--ph-header);
      color: var(--ph-text);
      font-weight: bold;
    }
    .ph-nav-icon { font-size: 13px; width: 16px; text-align: center; flex-shrink: 0; }
    .ph-nav-badge {
      margin-left: auto;
      min-width: 16px;
      height: 16px;
      border-radius: 8px;
      background: var(--ph-border-soft);
      color: var(--ph-text);
      font-size: 9px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .ph-nav-badge.ph-has-active {
      background: var(--ph-green);
      color: #fff;
    }
    .ph-nav-sep {
      height: 1px;
      background: var(--ph-border-soft);
      margin: 4px 8px;
    }
    .ph-nav-sep-automation { margin-top: auto; }

    /* --- Hub content area --- */
    .ph-hub-content {
      overflow-y: auto;
      padding: 12px;
      background: var(--ph-bg);
    }
    .ph-hub-content::-webkit-scrollbar { width: 4px; }
    .ph-hub-content::-webkit-scrollbar-track { background: var(--ph-bg); }
    .ph-hub-content::-webkit-scrollbar-thumb { background: var(--ph-border-soft); border-radius: 2px; }

    /* --- Home view --- */
    .ph-view-home { display: flex; flex-direction: column; gap: 12px; }

    .ph-profile-card {
      background: var(--ph-surface);
      border: 1px solid var(--ph-border-soft);
      border-radius: var(--ph-radius);
      padding: 10px 12px;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .ph-profile-avatar {
      width: 54px;
      height: 54px;
      border: 1px solid var(--ph-border-soft);
      border-radius: var(--ph-radius);
      background: var(--ph-surface-alt);
      color: var(--ph-text-2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 16px;
      line-height: 1;
      overflow: hidden;
      flex-shrink: 0;
    }
    .ph-profile-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .ph-profile-info { min-width: 0; flex: 1; }
    .ph-profile-name {
      font-weight: bold;
      font-size: 13px;
      color: var(--ph-text);
      margin-bottom: 2px;
    }
    .ph-profile-meta {
      font-size: 10px;
      color: var(--ph-text-2);
      line-height: 1.6;
    }
    .ph-profile-stats {
      font-size: 10px;
      color: var(--ph-text-2);
      line-height: 1.6;
    }
    .ph-profile-pill {
      display: inline-block;
      background: var(--ph-green);
      color: #fff;
      font-size: 9px;
      padding: 1px 6px;
      border-radius: 8px;
      margin-top: 4px;
    }

    .ph-section-heading {
      font-weight: bold;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--ph-text-dim);
      margin-bottom: 6px;
    }

    .ph-monitor {
      background: var(--ph-surface);
      border: 1px solid var(--ph-border-soft);
      border-radius: var(--ph-radius);
      overflow: hidden;
    }
    .ph-monitor-group-label {
      background: var(--ph-surface-alt);
      border-bottom: 1px solid var(--ph-border-soft);
      padding: 4px 10px;
      font-size: 10px;
      font-weight: bold;
      color: var(--ph-text-2);
    }
    .ph-monitor-row {
      padding: 7px 10px;
      border-bottom: 1px solid var(--ph-border-soft);
    }
    .ph-monitor-row:last-child { border-bottom: none; }
    .ph-mon-summary { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .ph-mon-mainline { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .ph-mon-icon { font-size: 14px; width: 18px; text-align: center; flex-shrink: 0; }
    .ph-mon-name { flex: 1; font-weight: bold; color: var(--ph-text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ph-mon-timer { font-size: 10px; color: var(--ph-text-dim); min-width: 54px; text-align: right; }
    .ph-mon-report, .ph-mon-breakdown, .ph-mon-message {
      margin-left: 26px;
      font-size: 10px;
      color: var(--ph-text-2);
      line-height: 1.45;
    }
    .ph-mon-breakdown summary {
      cursor: pointer;
      color: var(--ph-icon);
    }
    .ph-mon-message { color: var(--ph-text-dim); }
    .ph-mon-clear {
      margin-left: 26px;
      width: fit-content;
      padding: 2px 6px;
      background: var(--ph-surface-alt);
      border: 1px solid var(--ph-border);
      border-radius: var(--ph-radius);
      color: var(--ph-text-2);
      cursor: pointer;
      font-size: 9px;
      font-family: Verdana, sans-serif;
    }
    .ph-mon-clear:hover { border-color: var(--ph-icon); color: var(--ph-icon); }

    .ph-status-pill {
      font-size: 9px;
      padding: 2px 7px;
      border-radius: 8px;
      color: #fff;
      flex-shrink: 0;
    }
    .ph-status-pill.running   { background: var(--ph-status-running); }
    .ph-status-pill.waiting   { background: var(--ph-status-waiting); }
    .ph-status-pill.scheduled { background: var(--ph-status-scheduled); }
    .ph-status-pill.idle      { background: var(--ph-text-dim); }

    .ph-monitor-empty {
      padding: 12px 10px;
      color: var(--ph-text-dim);
      font-size: 11px;
      text-align: center;
    }

    /* --- Category view --- */
    .ph-view-cat { display: flex; flex-direction: column; gap: 6px; }

    .ph-cat-heading {
      font-weight: bold;
      font-size: 13px;
      color: var(--ph-text);
      margin-bottom: 4px;
      border-bottom: 1px solid var(--ph-border-soft);
      padding-bottom: 6px;
    }
    .ph-subcat-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
      border-bottom: 1px solid var(--ph-border-soft);
      padding-bottom: 6px;
    }
    .ph-subcat-tab {
      height: 24px;
      padding: 0 9px;
      border: 1px solid var(--ph-border-soft);
      border-radius: var(--ph-radius);
      background: var(--ph-surface);
      color: var(--ph-text-2);
      cursor: pointer;
      font-size: 10px;
      font-family: Verdana, sans-serif;
    }
    .ph-subcat-tab:hover { border-color: var(--ph-icon); color: var(--ph-icon); }
    .ph-subcat-tab.ph-sel {
      background: var(--ph-header);
      border-color: var(--ph-border);
      color: var(--ph-on-header);
      font-weight: bold;
    }
    .ph-workflow-note {
      background: var(--ph-surface);
      border: 1px solid var(--ph-border-soft);
      border-radius: var(--ph-radius);
      color: var(--ph-text-2);
      padding: 8px 10px;
      line-height: 1.45;
      margin-bottom: 8px;
    }
    .ph-workflow-list { display: flex; flex-direction: column; gap: 6px; }
    .ph-workflow-row {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      background: var(--ph-surface);
      border: 1px solid var(--ph-border-soft);
      border-radius: var(--ph-radius);
      padding: 8px 10px;
    }
    .ph-workflow-row span:nth-child(2) {
      font-weight: bold;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ph-workflow-row span:nth-child(3) {
      color: var(--ph-text-dim);
      font-size: 10px;
    }

    .ph-mod-row {
      background: var(--ph-surface);
      border: 1px solid var(--ph-border-soft);
      border-radius: var(--ph-radius);
      padding: 8px 10px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ph-mod-row-main { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
    .ph-mod-row-icon { font-size: 15px; width: 18px; text-align: center; flex-shrink: 0; }
    .ph-mod-row-text { min-width: 0; flex: 1; }
    .ph-mod-row-name { font-weight: bold; color: var(--ph-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ph-mod-row-meta { font-size: 9px; color: var(--ph-text-dim); margin-top: 1px; }
    .ph-mod-row-controls { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

    .ph-toggle {
      appearance: none;
      -webkit-appearance: none;
      width: 28px;
      height: 15px;
      border-radius: 8px;
      background: var(--ph-border-soft);
      position: relative;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s;
      border: none;
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

    .ph-btn-open, .ph-btn-config {
      height: 22px;
      padding: 0 9px;
      border-radius: var(--ph-radius);
      cursor: pointer;
      font-size: 9px;
      font-family: Verdana, sans-serif;
      flex-shrink: 0;
      border: 1px solid var(--ph-border);
      background: var(--ph-surface-alt);
      color: var(--ph-text);
    }
    .ph-btn-open:hover:not(:disabled) { border-color: var(--ph-icon); color: var(--ph-icon); }
    .ph-btn-config:hover:not(:disabled) { border-color: var(--ph-icon); color: var(--ph-icon); }
    .ph-btn-open:disabled, .ph-btn-config:disabled { color: var(--ph-text-dim); cursor: default; }

    .ph-empty-state {
      padding: 20px;
      text-align: center;
      color: var(--ph-text-dim);
    }

    /* --- Sub-page view --- */
    .ph-view-sub { display: flex; flex-direction: column; height: 100%; }

    .ph-sub-topbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding-bottom: 8px;
      margin-bottom: 8px;
      border-bottom: 1px solid var(--ph-border-soft);
      flex-shrink: 0;
    }
    .ph-sub-back {
      height: 22px;
      padding: 0 8px;
      background: var(--ph-surface-alt);
      border: 1px solid var(--ph-border);
      border-radius: var(--ph-radius);
      color: var(--ph-text-2);
      cursor: pointer;
      font-size: 10px;
      font-family: Verdana, sans-serif;
    }
    .ph-sub-back:hover { border-color: var(--ph-icon); color: var(--ph-icon); }
    .ph-sub-title { font-weight: bold; font-size: 12px; color: var(--ph-text); }

    .ph-sub-content { flex: 1; min-height: 0; overflow-y: auto; }
    .ph-sub-content::-webkit-scrollbar { width: 4px; }
    .ph-sub-content::-webkit-scrollbar-track { background: var(--ph-bg); }
    .ph-sub-content::-webkit-scrollbar-thumb { background: var(--ph-border-soft); border-radius: 2px; }

    /* ===== RIGHT-SIDE ICON STRIP ===== */
    #phantom-strip {
      position: fixed;
      right: 4px;
      top: 110px;
      display: flex;
      flex-direction: column;
      gap: 3px;
      z-index: var(--ph-z-strip);
      pointer-events: auto;
    }

    .ph-strip-item {
      width: 30px;
      height: 30px;
      background: var(--ph-bg);
      border: 1px solid var(--ph-border);
      border-radius: var(--ph-radius);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      user-select: none;
      position: relative;
      box-shadow: 0 1px 4px rgba(0,0,0,0.18);
    }
    .ph-strip-item:hover { border-color: var(--ph-icon); background: var(--ph-surface); }
    .ph-strip-item.ph-strip-launcher {
      font-size: 13px;
      overflow: hidden;
      padding: 0;
    }
    .ph-strip-item.ph-strip-launcher img {
      width: 26px;
      height: 26px;
      object-fit: cover;
      border-radius: var(--ph-brand-radius);
      display: block;
    }
    .ph-strip-collapse {
      height: 22px;
      font-size: 14px;
      color: var(--ph-text-2);
    }
    #phantom-strip.ph-strip-collapsed .ph-strip-collapse {
      border-color: var(--ph-icon);
      color: var(--ph-icon);
    }
    .ph-strip-badge {
      position: absolute;
      top: -3px;
      right: -3px;
      min-width: 12px;
      height: 12px;
      border-radius: 6px;
      background: var(--ph-green);
      color: #fff;
      font-size: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }

    /* ===== WINDOW MANAGER (reserved for floating overlays) ===== */
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
      box-shadow: 0 4px 24px rgba(0,0,0,0.35);
    }

    .ph-win-titlebar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 5px 8px;
      background: var(--ph-header);
      border-bottom: 1px solid var(--ph-border);
      cursor: move;
      user-select: none;
      flex-shrink: 0;
    }

    .ph-win-title {
      flex: 1;
      color: var(--ph-on-header);
      font-weight: bold;
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ph-win-btn {
      width: 18px;
      height: 18px;
      border: 1px solid rgba(62,38,6,0.3);
      border-radius: 3px;
      background: rgba(0,0,0,0.1);
      color: var(--ph-on-header);
      cursor: pointer;
      font-size: 10px;
      line-height: 1;
      padding: 0;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ph-win-btn:hover { background: rgba(0,0,0,0.25); }
    .ph-win-btn-close:hover { background: rgba(200,50,50,0.6); }

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

    /* ===== Notas Manuais module ===== */
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
    .ph-nm-preset:hover { border-color: var(--ph-gold); color: var(--ph-icon); }
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
    .ph-nm-btn:hover:not(:disabled) { border-color: var(--ph-icon); color: var(--ph-icon); }
    .ph-nm-btn:disabled { color: var(--ph-text-dim); cursor: default; }
    .ph-nm-btn-stop { color: #a05820; border-color: #8c4a1a; }
    .ph-nm-btn-stop:hover:not(:disabled) { color: #c06828; border-color: #c06828; }
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
    .ph-nm-log-line.ok   { color: var(--ph-green-text); }
    .ph-nm-log-line.err  { color: #a03020; }
    .ph-nm-log-line.info { color: var(--ph-text-dim); }

    /* ===== Auto Res Sender module ===== */
    .ph-ars { display: flex; flex-direction: column; gap: 10px; }
    .ph-ars-section {
      background: var(--ph-surface);
      border: 1px solid var(--ph-border-soft);
      border-radius: var(--ph-radius);
      padding: 8px;
    }
    .ph-ars-label {
      color: var(--ph-text-2);
      font-size: 10px;
      font-weight: bold;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .ph-ars-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .ph-ars-field {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
      color: var(--ph-text-2);
      font-size: 10px;
    }
    .ph-ars-input {
      width: 100%;
      box-sizing: border-box;
      background: var(--ph-bg-light);
      border: 1px solid var(--ph-border);
      border-radius: var(--ph-radius);
      color: var(--ph-text);
      font-size: 11px;
      font-family: Verdana, sans-serif;
      padding: 4px;
      min-height: 24px;
    }
    .ph-ars-dests { display: flex; flex-direction: column; gap: 5px; }
    .ph-ars-dest-row {
      display: grid;
      grid-template-columns: minmax(90px, 1fr) 90px auto;
      gap: 5px;
      align-items: center;
    }
    .ph-ars-btn, .ph-ars-primary {
      min-height: 24px;
      padding: 3px 8px;
      background: var(--ph-bg-light);
      border: 1px solid var(--ph-border);
      border-radius: var(--ph-radius);
      color: var(--ph-text);
      cursor: pointer;
      font-size: 10px;
      font-family: Verdana, sans-serif;
    }
    .ph-ars-btn:hover:not(:disabled), .ph-ars-primary:hover:not(:disabled) {
      border-color: var(--ph-icon);
      color: var(--ph-icon);
    }
    .ph-ars-primary {
      background: var(--ph-green);
      border-color: var(--ph-green);
      color: #fff;
      min-width: 90px;
    }
    .ph-ars-actions { display: flex; align-items: center; gap: 8px; }
    .ph-ars-status { font-size: 10px; color: var(--ph-text-dim); }

    /* ===== Renomear a Cores module ===== */
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
      color: var(--ph-rc-color, var(--ph-text-2));
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

  // src/ui/brand.ts
  var PHANTOM_MARK_DATA_URI = "data:image/png;base64,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";

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

  // src/ui/shell/index.ts
  var CATEGORY_LABELS = {
    "scripts-aldeia": "Scripts de aldeia",
    "farm-buscas": "Farm & buscas",
    "kit-ataque": "Kit ataque",
    "kit-defesa": "Kit defesa",
    "cunhagem": "Cunhagem",
    "notas-relatorios": "Notas & relat\xF3rios",
    "mapa": "Mapa",
    "tribo": "Tribo",
    "utilidades": "Utilidades",
    "captcha": "Captcha",
    "alertas": "Alertas"
  };
  var CATEGORY_ICONS = {
    "scripts-aldeia": "\u{1F3E0}",
    "farm-buscas": "\u{1F33E}",
    "kit-ataque": "\u2694\uFE0F",
    "kit-defesa": "\u{1F6E1}\uFE0F",
    "cunhagem": "\u{1FA99}",
    "notas-relatorios": "\u{1F4DD}",
    "mapa": "\u{1F5FA}\uFE0F",
    "tribo": "\u{1F3F0}",
    "utilidades": "\u{1F527}",
    "captcha": "\u{1F510}",
    "alertas": "\u{1F514}"
  };
  var CATEGORY_ORDER = [
    "scripts-aldeia",
    "farm-buscas",
    "kit-ataque",
    "kit-defesa",
    "cunhagem",
    "notas-relatorios",
    "mapa",
    "tribo",
    "utilidades",
    "captcha",
    "alertas"
  ];
  var AUTOMATION_NAV_KEY = "automacao";
  var AUTO_KINDS = /* @__PURE__ */ new Set(["auto", "page", "background"]);
  function createHub(modules, enabledState, gameData, scheduler, state, eventBus, callbacks) {
    let destroyed = false;
    let router = { view: "home" };
    const activeState = /* @__PURE__ */ new Map();
    const localEnabled = /* @__PURE__ */ new Map();
    const selectedSubcategory = /* @__PURE__ */ new Map();
    let stripCollapsed = false;
    const monitorDetails = /* @__PURE__ */ new Map();
    const monitorUnsubs = [];
    const monitorTimer = setInterval(updateMonitorTimers, 1e3);
    let profileDetails = null;
    for (const m of modules) localEnabled.set(m.id, enabledState[m.id] ?? true);
    for (const m of modules) {
      const key = `monitor:${m.id}`;
      const existing = state.get(key);
      if (existing) monitorDetails.set(m.id, existing);
      monitorUnsubs.push(eventBus.on(key, (details) => {
        monitorDetails.set(m.id, details);
        if (router.view === "home") renderContent();
      }));
    }
    const byCategory = /* @__PURE__ */ new Map();
    for (const cat of CATEGORY_ORDER) byCategory.set(cat, []);
    for (const m of modules) {
      const list = byCategory.get(m.category);
      if (list) list.push(m);
    }
    for (const cat of CATEGORY_ORDER) {
      const first = (byCategory.get(cat) ?? [])[0]?.subcategory ?? "Geral";
      selectedSubcategory.set(cat, first);
    }
    const activeCountForCat = (cat) => (byCategory.get(cat) ?? []).filter((m) => activeState.get(m.id)).length;
    const overlay = document.createElement("div");
    overlay.id = "phantom-overlay";
    overlay.classList.add("ph-hidden");
    const hub = document.createElement("div");
    hub.id = "phantom-hub";
    overlay.appendChild(hub);
    const header = document.createElement("div");
    header.className = "ph-hub-header";
    const brand = document.createElement("div");
    brand.className = "ph-hub-brand";
    const brandImg = document.createElement("img");
    brandImg.className = "ph-brand-mark";
    brandImg.src = PHANTOM_MARK_DATA_URI;
    brandImg.alt = "";
    brandImg.setAttribute("aria-hidden", "true");
    brand.appendChild(brandImg);
    const titleBlock = document.createElement("div");
    titleBlock.className = "ph-hub-titleblock";
    const titleEl = document.createElement("div");
    titleEl.className = "ph-hub-title";
    titleEl.textContent = "Phantom";
    const versionEl = document.createElement("div");
    versionEl.className = "ph-hub-version";
    versionEl.textContent = "v0.1";
    titleBlock.append(titleEl, versionEl);
    const closeBtn = document.createElement("button");
    closeBtn.className = "ph-hub-close";
    closeBtn.type = "button";
    closeBtn.title = "Fechar";
    closeBtn.textContent = "x";
    closeBtn.addEventListener("click", () => overlay.classList.add("ph-hidden"));
    header.append(brand, titleBlock, closeBtn);
    hub.appendChild(header);
    const body = document.createElement("div");
    body.className = "ph-hub-body";
    hub.appendChild(body);
    const sidebar = document.createElement("nav");
    sidebar.className = "ph-hub-sidebar";
    const contentArea = document.createElement("div");
    contentArea.className = "ph-hub-content";
    body.append(sidebar, contentArea);
    const navItems = /* @__PURE__ */ new Map();
    const navBadges = /* @__PURE__ */ new Map();
    const makeNavItem = (icon, label, key, onClick) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "ph-nav-item";
      el.dataset.key = key;
      const iconEl = document.createElement("span");
      iconEl.className = "ph-nav-icon";
      iconEl.textContent = icon;
      const labelEl = document.createElement("span");
      labelEl.textContent = label;
      el.append(iconEl, labelEl);
      el.addEventListener("click", onClick);
      navItems.set(key, el);
      return el;
    };
    sidebar.appendChild(makeNavItem("\u{1F47B}", "Inicio", "home", () => navigate({ view: "home" })));
    const sep = document.createElement("div");
    sep.className = "ph-nav-sep";
    sidebar.appendChild(sep);
    for (const cat of CATEGORY_ORDER) {
      const el = makeNavItem(CATEGORY_ICONS[cat], CATEGORY_LABELS[cat], cat, () => navigate({ view: "category", cat }));
      const badge = document.createElement("span");
      badge.className = "ph-nav-badge";
      badge.textContent = "0";
      navBadges.set(cat, badge);
      el.appendChild(badge);
      sidebar.appendChild(el);
    }
    const automationSep = document.createElement("div");
    automationSep.className = "ph-nav-sep ph-nav-sep-automation";
    sidebar.appendChild(automationSep);
    sidebar.appendChild(makeNavItem("\u2699\uFE0F", "Automacao", AUTOMATION_NAV_KEY, () => navigate({ view: "automation" })));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.add("ph-hidden");
    });
    document.body.appendChild(overlay);
    const strip = document.createElement("div");
    strip.id = "phantom-strip";
    const stripCollapse = document.createElement("button");
    stripCollapse.type = "button";
    stripCollapse.className = "ph-strip-item ph-strip-collapse";
    stripCollapse.title = "Recolher categorias";
    stripCollapse.textContent = "<";
    stripCollapse.addEventListener("click", () => {
      stripCollapsed = !stripCollapsed;
      stripCollapse.textContent = stripCollapsed ? ">" : "<";
      stripCollapse.title = stripCollapsed ? "Mostrar categorias" : "Recolher categorias";
      updateStrip();
    });
    strip.appendChild(stripCollapse);
    const stripCatIcons = /* @__PURE__ */ new Map();
    document.body.appendChild(strip);
    let questLauncher = null;
    void mountQuestLauncher();
    void loadProfileDetails().then((details) => {
      if (!details || destroyed) return;
      profileDetails = details;
      if (router.view === "home") renderContent();
    });
    function navigate(next) {
      if (router.view === "module" && next.view !== "module") {
        callbacks.onCloseModule(router.moduleId);
      }
      router = next;
      renderNav();
      renderContent();
    }
    function renderNav() {
      for (const [key, el] of navItems) {
        const sel = key === "home" && router.view === "home" || key === AUTOMATION_NAV_KEY && router.view === "automation" || router.view === "category" && router.cat === key || router.view === "module" && router.cat === key;
        el.classList.toggle("ph-sel", sel);
      }
      for (const [cat, badge] of navBadges) {
        const count = activeCountForCat(cat);
        badge.textContent = String(count);
        badge.classList.toggle("ph-has-active", count > 0);
      }
    }
    function renderContent() {
      contentArea.replaceChildren();
      if (router.view === "home") {
        renderHome();
      } else if (router.view === "category") {
        renderCategory(router.cat);
      } else if (router.view === "automation") {
        renderAutomation();
      } else if (router.view === "module") {
        renderModulePage(router.moduleId, router.cat, router.contentEl);
      }
      updateMonitorTimers();
    }
    function renderHome() {
      const view = document.createElement("div");
      view.className = "ph-view-home";
      const card = document.createElement("div");
      card.className = "ph-profile-card";
      const avatar = document.createElement("div");
      avatar.className = "ph-profile-avatar";
      if (profileDetails?.imageUrl) {
        const avatarImg = document.createElement("img");
        avatarImg.src = profileDetails.imageUrl;
        avatarImg.alt = gameData?.player.name ?? "Perfil";
        avatar.appendChild(avatarImg);
      } else {
        avatar.textContent = initials(gameData?.player.name);
      }
      const info = document.createElement("div");
      info.className = "ph-profile-info";
      const nameEl = document.createElement("div");
      nameEl.className = "ph-profile-name";
      nameEl.textContent = gameData?.player.name ?? "-";
      const meta = document.createElement("div");
      meta.className = "ph-profile-meta";
      const tribe = gameData?.player.ally_tag ? `[${gameData.player.ally_tag}]` : "Sem tribo";
      meta.innerHTML = `Mundo: <b>${gameData?.world ?? "-"}</b> &nbsp;-&nbsp; Tribo: <b>${tribe}</b>`;
      const stats = document.createElement("div");
      stats.className = "ph-profile-stats";
      const points = profileDetails?.points;
      const rank = profileDetails?.rank;
      stats.innerHTML = `Pontos: <b>${points ?? "-"}</b> &nbsp;-&nbsp; Classificacao: <b>${rank ?? "-"}</b>`;
      const pill = document.createElement("div");
      pill.className = "ph-profile-pill";
      pill.textContent = "Ativo";
      info.append(nameEl, meta, stats, pill);
      card.append(avatar, info);
      view.appendChild(card);
      const heading = document.createElement("div");
      heading.className = "ph-section-heading";
      heading.textContent = "Monitor de Atividades";
      view.appendChild(heading);
      const monitor = document.createElement("div");
      monitor.className = "ph-monitor";
      const autoMods = modules.filter((m) => AUTO_KINDS.has(m.activation));
      const bgMods = autoMods.filter((m) => m.activation === "background");
      const pageMods = autoMods.filter((m) => m.activation !== "background");
      if (autoMods.length === 0) {
        const empty = document.createElement("div");
        empty.className = "ph-monitor-empty";
        empty.textContent = "Nenhum modulo automatico ativo neste ecra.";
        monitor.appendChild(empty);
      } else {
        if (bgMods.length > 0) {
          const grpLabel = document.createElement("div");
          grpLabel.className = "ph-monitor-group-label";
          grpLabel.textContent = "Scripts de background";
          monitor.appendChild(grpLabel);
          for (const m of bgMods) monitor.appendChild(makeMonitorRow(m));
        }
        if (pageMods.length > 0) {
          const grpLabel = document.createElement("div");
          grpLabel.className = "ph-monitor-group-label";
          grpLabel.textContent = "Scripts de pagina";
          monitor.appendChild(grpLabel);
          for (const m of pageMods) monitor.appendChild(makeMonitorRow(m));
        }
      }
      view.appendChild(monitor);
      contentArea.appendChild(view);
    }
    function makeMonitorRow(m) {
      const row = document.createElement("div");
      row.className = "ph-monitor-row";
      const icon = document.createElement("span");
      icon.className = "ph-mon-icon";
      icon.textContent = m.icon;
      const name = document.createElement("span");
      name.className = "ph-mon-name";
      name.textContent = m.name;
      const isActive = activeState.get(m.id) ?? false;
      const details = monitorDetails.get(m.id);
      const pill = document.createElement("span");
      pill.className = "ph-status-pill";
      if (!localEnabled.get(m.id)) {
        pill.classList.add("idle");
        pill.textContent = "Desativado";
      } else if (details?.status === "running") {
        pill.classList.add("running");
        pill.textContent = "Em execu\xE7\xE3o";
      } else if (details?.status === "scheduled") {
        pill.classList.add("scheduled");
        pill.textContent = "Agendado";
      } else if (isActive) {
        pill.classList.add("running");
        pill.textContent = "Ativo";
      } else {
        pill.classList.add("idle");
        pill.textContent = "Inativo";
      }
      const timerEl = document.createElement("span");
      timerEl.className = "ph-mon-timer";
      if (m.activation === "background" && isActive) {
        const remaining = details?.nextCycle ? Math.max(0, details.nextCycle - Date.now()) : scheduler?.getRemaining(m.id) ?? 0;
        const nextCycle = details?.nextCycle ?? (remaining > 0 ? Date.now() + remaining : void 0);
        if (nextCycle) timerEl.dataset.nextCycle = String(nextCycle);
        timerEl.textContent = remaining > 0 ? formatDuration(remaining) : "-";
      }
      const summary = document.createElement("div");
      summary.className = "ph-mon-summary";
      const mainLine = document.createElement("div");
      mainLine.className = "ph-mon-mainline";
      mainLine.append(icon, name, pill, timerEl);
      summary.appendChild(mainLine);
      if (details?.stats) {
        const s = details.stats;
        const report = document.createElement("div");
        report.className = "ph-mon-report";
        report.textContent = `Ciclos: ${s.cycles} \xB7 Transportes: ${s.transports} \xB7 Madeira: ${formatNumber(s.wood)} \xB7 Argila: ${formatNumber(s.stone)} \xB7 Ferro: ${formatNumber(s.iron)}`;
        summary.appendChild(report);
        const clearStats = document.createElement("button");
        clearStats.type = "button";
        clearStats.className = "ph-mon-clear";
        clearStats.textContent = "Limpar estat\xEDsticas";
        clearStats.addEventListener("click", () => eventBus.emit(`monitor:clear:${m.id}`, void 0));
        summary.appendChild(clearStats);
        if (s.lastBreakdown && s.lastBreakdown.length > 0) {
          const breakdown = document.createElement("details");
          breakdown.className = "ph-mon-breakdown";
          const breakdownTitle = document.createElement("summary");
          breakdownTitle.textContent = "\xDAltimo ciclo";
          breakdown.appendChild(breakdownTitle);
          for (const dest of s.lastBreakdown) {
            const line = document.createElement("div");
            line.textContent = `${dest.coord}: ${dest.transports} envios, ${formatNumber(dest.wood)}/${formatNumber(dest.stone)}/${formatNumber(dest.iron)}`;
            breakdown.appendChild(line);
          }
          summary.appendChild(breakdown);
        }
        if (details.message) {
          const msg = document.createElement("div");
          msg.className = "ph-mon-message";
          msg.textContent = details.message;
          summary.appendChild(msg);
        }
      }
      row.appendChild(summary);
      return row;
    }
    function renderCategory(cat) {
      const view = document.createElement("div");
      view.className = "ph-view-cat";
      const heading = document.createElement("div");
      heading.className = "ph-cat-heading";
      heading.textContent = CATEGORY_LABELS[cat];
      view.appendChild(heading);
      const mods = byCategory.get(cat) ?? [];
      const subcategories = uniqueSubcategories(mods);
      if (subcategories.length > 1) {
        const tabs = document.createElement("div");
        tabs.className = "ph-subcat-tabs";
        const selected2 = selectedSubcategory.get(cat) ?? subcategories[0];
        for (const subcat of subcategories) {
          const count = mods.filter((m) => (m.subcategory ?? "Geral") === subcat).length;
          const tab = document.createElement("button");
          tab.type = "button";
          tab.className = "ph-subcat-tab";
          tab.classList.toggle("ph-sel", subcat === selected2);
          tab.textContent = `${subcat} (${count})`;
          tab.addEventListener("click", () => {
            selectedSubcategory.set(cat, subcat);
            renderContent();
          });
          tabs.appendChild(tab);
        }
        view.appendChild(tabs);
      }
      const selected = selectedSubcategory.get(cat) ?? subcategories[0] ?? "Geral";
      const visibleMods = subcategories.length > 1 ? mods.filter((m) => (m.subcategory ?? "Geral") === selected) : mods;
      if (mods.length === 0) {
        const empty = document.createElement("div");
        empty.className = "ph-empty-state";
        empty.textContent = cat === "captcha" ? "Em breve." : "Nenhum m\xF3dulo dispon\xEDvel nesta categoria neste ecr\xE3.";
        view.appendChild(empty);
      } else if (visibleMods.length === 0) {
        const empty = document.createElement("div");
        empty.className = "ph-empty-state";
        empty.textContent = "Nenhum m\xF3dulo dispon\xEDvel nesta subcategoria.";
        view.appendChild(empty);
      } else {
        for (const m of visibleMods) {
          view.appendChild(makeModRow(m, cat));
        }
      }
      contentArea.appendChild(view);
    }
    function renderAutomation() {
      const view = document.createElement("div");
      view.className = "ph-view-cat";
      const heading = document.createElement("div");
      heading.className = "ph-cat-heading";
      heading.textContent = "Automa\xE7\xE3o";
      view.appendChild(heading);
      const note = document.createElement("div");
      note.className = "ph-workflow-note";
      note.textContent = "Construtor de workflows. O motor fica deferido at\xE9 existirem pelo menos dois scripts encade\xE1veis.";
      view.appendChild(note);
      const chainable = modules.filter((m) => m.chainable);
      if (chainable.length === 0) {
        const empty = document.createElement("div");
        empty.className = "ph-empty-state";
        empty.textContent = "Nenhum m\xF3dulo encade\xE1vel dispon\xEDvel.";
        view.appendChild(empty);
      } else {
        const list = document.createElement("div");
        list.className = "ph-workflow-list";
        for (const m of chainable) {
          const row = document.createElement("div");
          row.className = "ph-workflow-row";
          const icon = document.createElement("span");
          icon.textContent = m.icon;
          const name = document.createElement("span");
          name.textContent = m.name;
          const meta = document.createElement("span");
          meta.textContent = `${CATEGORY_LABELS[m.category]} \xB7 ${m.subcategory ?? "Geral"}`;
          row.append(icon, name, meta);
          list.appendChild(row);
        }
        view.appendChild(list);
      }
      contentArea.appendChild(view);
    }
    function makeModRow(m, cat) {
      const row = document.createElement("div");
      row.className = "ph-mod-row";
      const main = document.createElement("div");
      main.className = "ph-mod-row-main";
      const iconEl = document.createElement("span");
      iconEl.className = "ph-mod-row-icon";
      iconEl.textContent = m.icon;
      const text = document.createElement("div");
      text.className = "ph-mod-row-text";
      const nameEl = document.createElement("div");
      nameEl.className = "ph-mod-row-name";
      nameEl.textContent = m.name;
      if (m.description) nameEl.title = m.description;
      const metaEl = document.createElement("div");
      metaEl.className = "ph-mod-row-meta";
      metaEl.textContent = m.activation + (m.surface ? " - " + (m.surface === "tool" ? "ferramenta" : "configuravel") : "");
      text.append(nameEl, metaEl);
      main.append(iconEl, text);
      const controls = document.createElement("div");
      controls.className = "ph-mod-row-controls";
      if (m.surface) {
        const label = m.surface === "tool" ? "Abrir" : "Configurar";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = m.surface === "tool" ? "ph-btn-open" : "ph-btn-config";
        btn.textContent = label;
        btn.addEventListener("click", () => {
          const contentEl = document.createElement("div");
          void callbacks.onOpenModule(m.id, contentEl).then(() => {
            navigate({ view: "module", moduleId: m.id, cat, contentEl });
          });
        });
        controls.appendChild(btn);
      }
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.className = "ph-toggle";
      toggle.title = localEnabled.get(m.id) ? "Desativar modulo" : "Ativar modulo";
      toggle.checked = localEnabled.get(m.id) ?? true;
      toggle.addEventListener("change", () => {
        const enabled = toggle.checked;
        localEnabled.set(m.id, enabled);
        callbacks.onToggleEnable(m.id, enabled);
        if (!enabled && router.view === "module" && router.moduleId === m.id) {
          navigate({ view: "category", cat });
        }
        updateCategoryBadge(m.category);
      });
      controls.appendChild(toggle);
      row.append(main, controls);
      return row;
    }
    function renderModulePage(moduleId, cat, contentEl) {
      const m = modules.find((mod) => mod.id === moduleId);
      const view = document.createElement("div");
      view.className = "ph-view-sub";
      const topbar = document.createElement("div");
      topbar.className = "ph-sub-topbar";
      const backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.className = "ph-sub-back";
      backBtn.textContent = "< Voltar";
      backBtn.addEventListener("click", () => navigate({ view: "category", cat }));
      const titleEl2 = document.createElement("span");
      titleEl2.className = "ph-sub-title";
      titleEl2.textContent = m?.name ?? moduleId;
      topbar.append(backBtn, titleEl2);
      const subContent = document.createElement("div");
      subContent.className = "ph-sub-content";
      subContent.appendChild(contentEl);
      view.append(topbar, subContent);
      contentArea.appendChild(view);
    }
    function updateStrip() {
      for (const [, el] of stripCatIcons) el.remove();
      stripCatIcons.clear();
      strip.classList.toggle("ph-strip-collapsed", stripCollapsed);
      if (stripCollapsed) return;
      for (const cat of CATEGORY_ORDER) {
        const count = activeCountForCat(cat);
        if (count === 0) continue;
        const item = document.createElement("button");
        item.type = "button";
        item.className = "ph-strip-item";
        item.title = CATEGORY_LABELS[cat];
        item.textContent = CATEGORY_ICONS[cat];
        if (count > 0) {
          const badge = document.createElement("span");
          badge.className = "ph-strip-badge";
          badge.textContent = String(count);
          item.appendChild(badge);
        }
        item.addEventListener("click", () => {
          overlay.classList.remove("ph-hidden");
          navigate({ view: "category", cat });
        });
        strip.appendChild(item);
        stripCatIcons.set(cat, item);
      }
    }
    function updateCategoryBadge(cat) {
      const badge = navBadges.get(cat);
      if (badge) {
        const count = activeCountForCat(cat);
        badge.textContent = String(count);
        badge.classList.toggle("ph-has-active", count > 0);
      }
      updateStrip();
    }
    renderNav();
    renderContent();
    updateStrip();
    return {
      setActive(id, active) {
        if (destroyed) return;
        activeState.set(id, active);
        const m = modules.find((mod) => mod.id === id);
        if (m) updateCategoryBadge(m.category);
        if (router.view === "home") renderContent();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        clearInterval(monitorTimer);
        for (const unsub of monitorUnsubs) unsub();
        questLauncher?.remove();
        overlay.remove();
        strip.remove();
      }
    };
    async function mountQuestLauncher() {
      const anchorEl = await waitForElement("new_quest", 5e3);
      if (!anchorEl || destroyed) return;
      const launcher = document.createElement("div");
      launcher.id = "phantom-launcher";
      launcher.className = "quest";
      launcher.title = "Phantom";
      const launcherMark = document.createElement("img");
      launcherMark.className = "ph-launcher-mark";
      launcherMark.src = PHANTOM_MARK_DATA_URI;
      launcherMark.alt = "Phantom";
      launcher.appendChild(launcherMark);
      launcher.addEventListener("click", () => overlay.classList.toggle("ph-hidden"));
      anchorEl.insertAdjacentElement("afterend", launcher);
      questLauncher = launcher;
    }
    function updateMonitorTimers() {
      if (destroyed) return;
      contentArea.querySelectorAll(".ph-mon-timer[data-next-cycle]").forEach((el) => {
        const nextCycle = parseInt(el.dataset.nextCycle ?? "", 10);
        if (!Number.isFinite(nextCycle)) return;
        const remaining = Math.max(0, nextCycle - Date.now());
        el.textContent = remaining > 0 ? formatDuration(remaining) : "-";
      });
    }
  }
  function formatDuration(ms) {
    const s = Math.floor(ms / 1e3);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}m${rem > 0 ? ` ${rem}s` : ""}`;
  }
  function formatNumber(value) {
    return Math.floor(value).toLocaleString();
  }
  function uniqueSubcategories(modules) {
    const values = /* @__PURE__ */ new Set();
    for (const module of modules) values.add(module.subcategory ?? "Geral");
    if (modules.some((module) => module.category === "farm-buscas")) {
      values.add("Recursos");
      values.add("Buscas");
    }
    return Array.from(values);
  }
  function initials(label) {
    const parts = (label ?? "P").split(/\s+/).map((part) => part.trim()).filter(Boolean);
    const text = (parts[0]?.[0] ?? "P") + (parts[1]?.[0] ?? "");
    return text.toUpperCase();
  }
  async function loadProfileDetails() {
    const playerId = window.game_data?.player?.id;
    if (!playerId) return null;
    const url = new URL("/game.php", window.location.origin);
    const villageId = window.game_data?.village?.id;
    if (villageId) url.searchParams.set("village", String(villageId));
    url.searchParams.set("screen", "info_player");
    url.searchParams.set("id", String(playerId));
    const res = await fetch(url.toString(), { credentials: "same-origin" });
    if (!res.ok) return null;
    const html = await res.text();
    return parseProfileDetails(html);
  }
  function parseProfileDetails(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const playerInfo = doc.querySelector("#player_info");
    const image = playerInfo?.querySelector(
      'img[src*="/graphic/userimage/"], img[src*="graphic/userimage/"], img[alt="Imagem pessoal"]'
    );
    const details = {
      imageUrl: image?.src
    };
    playerInfo?.querySelectorAll("tr").forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 2) return;
      const label = normalizeLabel(cells[0]?.textContent);
      const value = cleanText(cells[1]?.textContent);
      if (label.startsWith("pontos")) details.points = value;
      if (label.startsWith("classifica")) details.rank = value;
    });
    return details;
  }
  function normalizeLabel(text) {
    return cleanText(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  function cleanText(text) {
    return (text ?? "").replace(/\s+/g, " ").trim();
  }

  // src/core/shell.ts
  var AUTO_KINDS2 = ["auto", "page", "background"];
  var enabledKey = (id) => `enabled:${id}`;
  async function bootShell(registry, services, state, eventBus, screen) {
    injectTheme();
    const storage = services.storage;
    const available = registry.available(screen);
    const enabledState = {};
    for (const mod of available) {
      const stored = await storage.get(enabledKey(mod.id));
      enabledState[mod.id] = stored ?? false;
    }
    let hub = null;
    if (services.windows) {
      services.windows.onWindowClosed((id) => {
        registry.deactivate(id);
        hub?.setActive(id, false);
      });
    }
    for (const mod of available) {
      if (AUTO_KINDS2.includes(mod.activation) && enabledState[mod.id]) {
        void registry.activate(mod.id).then(() => {
          hub?.setActive(mod.id, registry.isActive(mod.id));
        });
      }
    }
    hub = createHub(
      available,
      enabledState,
      services.gameData.snapshot(),
      services.scheduler,
      state,
      eventBus,
      {
        async onToggleEnable(id, enabled) {
          enabledState[id] = enabled;
          await storage.set(enabledKey(id), enabled);
          const manifest5 = available.find((m) => m.id === id);
          if (!manifest5) return;
          if (AUTO_KINDS2.includes(manifest5.activation)) {
            if (enabled) {
              await registry.activate(id);
              hub?.setActive(id, registry.isActive(id));
            } else {
              registry.deactivate(id);
              hub?.setActive(id, false);
            }
          } else if (!enabled && registry.isActive(id)) {
            registry.deactivate(id);
            hub?.setActive(id, false);
          }
        },
        async onOpenModule(id, contentEl) {
          const manifest5 = available.find((m) => m.id === id);
          const keepBackgroundAlive = manifest5?.activation === "background" && registry.isActive(id);
          if (registry.isActive(id) && !keepBackgroundAlive) {
            registry.deactivate(id);
          }
          await registry.activate(id, contentEl);
          hub?.setActive(id, registry.isActive(id));
        },
        onCloseModule(id) {
          const manifest5 = available.find((m) => m.id === id);
          if (manifest5?.activation === "background") {
            registry.disposeUi(id);
            return;
          }
          registry.deactivate(id);
          hub?.setActive(id, false);
        },
        async onRunCommand(id) {
          await registry.activate(id);
          registry.deactivate(id);
        }
      }
    );
  }

  // src/modules/status-overview/manifest.ts
  var manifest = {
    id: "status-overview",
    name: "Status Overview",
    version: "0.1.0",
    category: "scripts-aldeia",
    subcategory: "Geral",
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
    category: "notas-relatorios",
    subcategory: "Notas",
    activation: "toggle",
    allowedScreens: ["*"],
    // coordinate-based; works on any screen
    icon: "\u{1F4DD}",
    description: "Adiciona notas a aldeias por coordenadas",
    surface: "tool"
    // "Abrir" button -> renders as hub sub-page
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
    const section2 = document.createElement("div");
    section2.className = "ph-nm-section";
    const lbl = document.createElement("label");
    lbl.className = "ph-nm-label";
    lbl.textContent = label;
    section2.appendChild(lbl);
    return section2;
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
      if (ctx.hubContent) {
        const ui = await initUi2(ctx, ctx.hubContent);
        cleanupUi2 = ui.destroy;
        return;
      }
      if (ctx.services.windows) {
        windowHandle = ctx.services.windows.open({
          moduleId: manifest2.id,
          title: "Notas Manuais por Coordenadas",
          defaultSize: { w: 480, h: 520 },
          defaultPos: { x: 200, y: 80 }
        });
        const ui = await initUi2(ctx, windowHandle.contentEl);
        cleanupUi2 = ui.destroy;
      }
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
    category: "kit-defesa",
    subcategory: "Renomear",
    activation: "page",
    allowedScreens: [
      "overview" /* OVERVIEW */,
      "overview_villages" /* OVERVIEW_VILLAGES */,
      "info_village" /* INFO_VILLAGE */,
      "place" /* PLACE */
    ],
    icon: "\u{1F3A8}",
    description: "Botoes de renomeacao rapida com cores nos ataques recebidos"
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
      const input2 = row.querySelector('input[type="text"]');
      if (!input2) return;
      observer.disconnect();
      clearTimeout(timeout);
      input2.value = newName;
      const submit = row.querySelector('input[type="button"]');
      if (submit) {
        submit.click();
      } else {
        input2.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
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
      const input2 = cell.querySelector('.quickedit-input, input[type="text"]');
      if (!input2) return;
      observer.disconnect();
      clearTimeout(timeout);
      input2.value = newName;
      const save = cell.querySelector(".quickedit-save");
      if (save) {
        save.click();
      } else {
        input2.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
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

  // src/modules/auto-res-sender/manifest.ts
  var manifest4 = {
    id: "auto-res-sender",
    name: "Auto Res Sender",
    version: "1.0.0",
    category: "cunhagem",
    subcategory: "Recursos",
    chainable: true,
    activation: "background",
    allowedScreens: ["*"],
    icon: "\u{1F4E6}",
    description: "Envia recursos automaticamente para destinos configurados",
    surface: "config"
  };

  // src/modules/auto-res-sender/constants.ts
  var MODULE_ID = "auto-res-sender";
  var RES_WOOD_PCT = 28e3 / 83e3;
  var RES_STONE_PCT = 3e4 / 83e3;
  var RES_IRON_PCT = 25e3 / 83e3;
  var DEFAULT_CONFIG = {
    globalLimitMin: 120,
    safetyLimitMin: 120,
    limitMode: "global",
    totalRuntime: "12h",
    cycleInterval: "30min",
    resPercent: 0,
    groupId: "0",
    minPerFieldOverride: 0
  };
  var RUNTIME_OPTIONS = ["1h", "6h", "8h", "12h", "24h", "32h", "48h"];
  var CYCLE_OPTIONS = ["5min", "15min", "30min", "1h", "2h", "4h", "6h", "8h"];
  var SEND_DELAY_MIN_MS = 350;
  var SEND_DELAY_RANDOM_MS = 100;
  var COORD_RESOLVE_DELAY_MS = 150;
  var AFTER_EXECUTE_SENDS_DELAY_MS = 300;
  var MAP_SEND_TIMEOUT_MS = 8e3;
  var LEGACY_STORAGE_PREFIX = "k1mmis_ressender_";
  var MERCHANT_MIN_FIELD_KEY_PREFIX = `${LEGACY_STORAGE_PREFIX}merch_minfield_v2_`;
  var STORAGE_KEYS = {
    config: `${MODULE_ID}:config`,
    runtime: `${MODULE_ID}:runtime`,
    stats: `${MODULE_ID}:stats`,
    monitor: `monitor:${MODULE_ID}`,
    schedulerNext: `scheduler:next:${MODULE_ID}`
  };

  // src/modules/auto-res-sender/service.ts
  var DEFAULT_STATS = {
    cycles: 0,
    transports: 0,
    wood: 0,
    stone: 0,
    iron: 0,
    lastBreakdown: []
  };
  var AutoResSenderService = class {
    constructor(ctx) {
      this.ctx = ctx;
      this.destroyed = false;
      this.unsubscribeClear = ctx.eventBus.on(`monitor:clear:${MODULE_ID}`, () => {
        void this.clearStats();
      });
    }
    async start() {
      this.ctx.services.keepAlive?.acquire(MODULE_ID);
      const storage = this.storage();
      const existing = await storage.get(STORAGE_KEYS.runtime);
      const now = Date.now();
      if (!existing || now >= existing.endTime) {
        const config = await this.loadConfig();
        const runtime = this.createFreshRuntime(config, now);
        await storage.set(STORAGE_KEYS.stats, { ...DEFAULT_STATS });
        await this.saveRuntime(runtime);
        await this.publishMonitor("scheduled", runtime.nextCycle);
      } else {
        await this.saveRuntime({ ...existing, running: false });
        await this.publishMonitor("scheduled", existing.nextCycle);
      }
      await this.registerScheduler();
    }
    async stop() {
      this.destroyed = true;
      this.unsubscribeClear();
      this.ctx.services.keepAlive?.release(MODULE_ID);
      await this.ctx.services.scheduler?.unregister(MODULE_ID);
      await this.storage().remove(STORAGE_KEYS.runtime);
      await this.publishMonitor("off");
    }
    async loadConfig() {
      const stored = await this.storage().get(STORAGE_KEYS.config);
      return normalizeConfig(stored);
    }
    async saveConfig(config) {
      const normalized = normalizeConfig(config);
      const storage = this.storage();
      await storage.set(STORAGE_KEYS.config, normalized);
      const runtime = await storage.get(STORAGE_KEYS.runtime);
      if (runtime) {
        const updated = {
          ...runtime,
          endTime: runtime.startTime + parseDurationMs(normalized.totalRuntime)
        };
        await this.saveRuntime(updated);
        await this.publishMonitor(updated.running ? "running" : "scheduled", updated.nextCycle);
      }
    }
    async clearStats() {
      await this.storage().set(STORAGE_KEYS.stats, { ...DEFAULT_STATS });
      const runtime = await this.storage().get(STORAGE_KEYS.runtime);
      await this.publishMonitor(runtime ? runtime.running ? "running" : "scheduled" : "off", runtime?.nextCycle);
    }
    async runCycle() {
      if (this.destroyed) return false;
      const storage = this.storage();
      const runtime = await storage.get(STORAGE_KEYS.runtime);
      if (!runtime) {
        await this.publishMonitor("off");
        return false;
      }
      const now = Date.now();
      if (now >= runtime.endTime) {
        await storage.remove(STORAGE_KEYS.runtime);
        await this.publishMonitor("off", void 0, "Tempo total terminado.");
        return false;
      }
      await this.saveRuntime({ ...runtime, running: true });
      await this.publishMonitor("running", runtime.nextCycle);
      try {
        const config2 = await this.loadConfig();
        const villages = await this.collectProductionData(config2.groupId);
        const destinations = await this.resolveDestinations(config2.destinations);
        const minPerField = await this.getMinPerField(config2);
        const result = await this.executeSends(villages, destinations, config2, minPerField);
        await delay3(AFTER_EXECUTE_SENDS_DELAY_MS);
        await this.mergeStats(result);
      } catch (error) {
        this.ctx.services.logger.error(error instanceof Error ? error.message : String(error));
      }
      const latest = await storage.get(STORAGE_KEYS.runtime);
      if (!latest) return false;
      const after = Date.now();
      if (after >= latest.endTime) {
        await storage.remove(STORAGE_KEYS.runtime);
        await this.publishMonitor("off", void 0, "Tempo total terminado.");
        return false;
      }
      const config = await this.loadConfig();
      const nextCycle = after + parseDurationMs(config.cycleInterval);
      await this.saveRuntime({ ...latest, running: false, nextCycle });
      await this.publishMonitor("scheduled", nextCycle);
      return true;
    }
    calcSendAmounts(village, resPercent) {
      const merchantCarry = village.merchants * 1e3;
      const leaveBehind = Math.floor(village.warehouse / 100 * resPercent);
      const localWood = Math.max(0, village.wood - leaveBehind);
      const localStone = Math.max(0, village.stone - leaveBehind);
      const localIron = Math.max(0, village.iron - leaveBehind);
      let mWood = merchantCarry * RES_WOOD_PCT;
      let mStone = merchantCarry * RES_STONE_PCT;
      let mIron = merchantCarry * RES_IRON_PCT;
      if (mWood > localWood && mWood > 0) {
        const perc = localWood / mWood;
        mWood *= perc;
        mStone *= perc;
        mIron *= perc;
      }
      if (mStone > localStone && mStone > 0) {
        const perc = localStone / mStone;
        mWood *= perc;
        mStone *= perc;
        mIron *= perc;
      }
      if (mIron > localIron && mIron > 0) {
        const perc = localIron / mIron;
        mWood *= perc;
        mStone *= perc;
        mIron *= perc;
      }
      return {
        wood: Math.max(0, Math.floor(mWood)),
        stone: Math.max(0, Math.floor(mStone)),
        iron: Math.max(0, Math.floor(mIron))
      };
    }
    async registerScheduler() {
      const scheduler = this.ctx.services.scheduler;
      if (!scheduler) throw new Error("AutoResSender: SchedulerService unavailable");
      const config = await this.loadConfig();
      const runtime = await this.storage().get(STORAGE_KEYS.runtime);
      if (runtime) await this.storage().set(STORAGE_KEYS.schedulerNext, runtime.nextCycle);
      await scheduler.register({
        id: MODULE_ID,
        interval: parseDurationMs(config.cycleInterval),
        run: () => this.runCycle()
      });
    }
    async collectProductionData(groupId) {
      const request = this.request();
      const url = this.gameUrl();
      url.searchParams.set("screen", "overview_villages");
      url.searchParams.set("mode", "prod");
      url.searchParams.set("page", "-1");
      url.searchParams.set("group", groupId);
      this.addSitterParam(url);
      const res = await request.get(url.pathname + url.search);
      if (!res.ok) throw new Error(`AutoResSender: production fetch failed (${res.status})`);
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      return parseProductionDocument(doc);
    }
    async resolveDestinations(configured) {
      const result = [];
      for (const dest of configured) {
        const coord = normalizeCoord(dest.coord);
        if (!coord) continue;
        const resolved = await this.resolveCoord(coord);
        if (resolved) result.push({ ...dest, coord, ...resolved });
        await delay3(COORD_RESOLVE_DELAY_MS);
      }
      return result;
    }
    async resolveCoord(coord) {
      const url = this.gameUrl();
      url.searchParams.set("screen", "api");
      url.searchParams.set("ajax", "target_selection");
      url.searchParams.set("input", coord);
      url.searchParams.set("type", "coord");
      this.addSitterParam(url);
      const res = await this.request().get(url.pathname + url.search);
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      const id = findString(data, ["id", "village_id", "target_id"]);
      const [x, y] = coord.split("|").map((n) => parseInt(n, 10));
      return id && Number.isFinite(x) && Number.isFinite(y) ? { id, x, y } : null;
    }
    async getMinPerField(config) {
      if (config.minPerFieldOverride > 0) return config.minPerFieldOverride;
      const gd = this.ctx.services.gameData.snapshot();
      const world = gd?.world ?? "";
      const cacheKey = `${MERCHANT_MIN_FIELD_KEY_PREFIX}${world}`;
      const cached = await this.storage().get(cacheKey);
      if (cached && cached > 0) return cached;
      const speed = gd?.speed && gd.speed > 0 ? gd.speed : (await this.worldConfig().get()).speed;
      const minPerField = 6 / speed;
      await this.storage().set(cacheKey, minPerField);
      return minPerField;
    }
    async executeSends(villages, destinations, config, minPerField) {
      const destIds = new Set(destinations.map((d) => d.id));
      const breakdown = /* @__PURE__ */ new Map();
      let transports = 0;
      let wood = 0;
      let stone = 0;
      let iron = 0;
      for (const source of villages) {
        if (destIds.has(source.id)) continue;
        if (source.wood + source.stone + source.iron <= 0) continue;
        if (source.merchants <= 0) continue;
        const amounts = this.calcSendAmounts(source, config.resPercent);
        if (amounts.wood + amounts.stone + amounts.iron <= 0) continue;
        let bestAny = null;
        let best = null;
        for (const dest of destinations) {
          const fields = distance(source.x, source.y, dest.x, dest.y);
          const travelMin = fields * minPerField;
          const limit = config.limitMode === "perdest" ? dest.limitMin : config.globalLimitMin;
          if (!bestAny || travelMin < bestAny.travelMin) bestAny = { dest, travelMin };
          if (travelMin <= limit && (!best || travelMin < best.travelMin)) best = { dest, travelMin };
        }
        const picked = best ?? (bestAny && bestAny.travelMin <= config.safetyLimitMin ? bestAny : null);
        if (!picked) continue;
        const sent = await this.sendResources(source.id, picked.dest, amounts);
        if (sent.sent) {
          transports++;
          wood += amounts.wood;
          stone += amounts.stone;
          iron += amounts.iron;
          const key = picked.dest.id;
          const row = breakdown.get(key) ?? {
            coord: picked.dest.coord,
            id: picked.dest.id,
            transports: 0,
            wood: 0,
            stone: 0,
            iron: 0
          };
          row.transports++;
          row.wood += amounts.wood;
          row.stone += amounts.stone;
          row.iron += amounts.iron;
          breakdown.set(key, row);
        }
        await delay3(SEND_DELAY_MIN_MS + Math.random() * SEND_DELAY_RANDOM_MS);
      }
      return { transports, wood, stone, iron, breakdown: Array.from(breakdown.values()) };
    }
    async sendResources(sourceId, dest, amounts) {
      if (amounts.wood + amounts.stone + amounts.iron <= 0) return { sent: false, reason: "zero_res" };
      if (sourceId === dest.id) return { sent: false, reason: "same_village" };
      try {
        const payload = await withTimeout(
          this.request().twPost(
            "market",
            { ajaxaction: "map_send", village: sourceId },
            { target_id: dest.id, wood: amounts.wood, stone: amounts.stone, iron: amounts.iron }
          ),
          MAP_SEND_TIMEOUT_MS
        );
        const error = extractMapSendError(payload);
        if (error) return { sent: false, reason: error };
        return { sent: true, dest, amounts };
      } catch (error) {
        return { sent: false, reason: error instanceof Error ? error.message : String(error) };
      }
    }
    async mergeStats(cycle) {
      const storage = this.storage();
      const stats = await storage.get(STORAGE_KEYS.stats) ?? { ...DEFAULT_STATS };
      const updated = {
        cycles: stats.cycles + 1,
        transports: stats.transports + cycle.transports,
        wood: stats.wood + cycle.wood,
        stone: stats.stone + cycle.stone,
        iron: stats.iron + cycle.iron,
        lastBreakdown: cycle.breakdown
      };
      await storage.set(STORAGE_KEYS.stats, updated);
    }
    createFreshRuntime(config, now) {
      return {
        startTime: now,
        endTime: now + parseDurationMs(config.totalRuntime),
        nextCycle: now,
        running: false
      };
    }
    async saveRuntime(runtime) {
      await this.storage().set(STORAGE_KEYS.runtime, runtime);
      await this.storage().set(STORAGE_KEYS.schedulerNext, runtime.nextCycle);
    }
    async publishMonitor(status, nextCycle, message) {
      const stats = await this.storage().get(STORAGE_KEYS.stats) ?? { ...DEFAULT_STATS };
      const monitor = { status, nextCycle, stats, message };
      this.ctx.state.set(STORAGE_KEYS.monitor, monitor);
      this.ctx.eventBus.emit(STORAGE_KEYS.monitor, monitor);
    }
    gameUrl() {
      return new URL("/game.php", window.location.origin);
    }
    addSitterParam(url) {
      const gd = this.ctx.services.gameData.snapshot();
      if (gd && gd.player.sitter > 0) url.searchParams.set("t", gd.player.id);
    }
    storage() {
      const storage = this.ctx.services.storage;
      if (!storage) throw new Error("AutoResSender: StorageService unavailable");
      return storage;
    }
    request() {
      const request = this.ctx.services.request;
      if (!request) throw new Error("AutoResSender: RequestService unavailable");
      return request;
    }
    worldConfig() {
      const worldConfig = this.ctx.services.worldConfig;
      if (!worldConfig) throw new Error("AutoResSender: WorldConfigService unavailable");
      return worldConfig;
    }
  };
  function normalizeConfig(raw) {
    const runtime = RUNTIME_OPTIONS.includes(raw?.totalRuntime) ? raw.totalRuntime : DEFAULT_CONFIG.totalRuntime;
    const cycle = CYCLE_OPTIONS.includes(raw?.cycleInterval) ? raw.cycleInterval : DEFAULT_CONFIG.cycleInterval;
    return {
      destinations: Array.isArray(raw?.destinations) ? raw.destinations.map(normalizeDestination).filter(Boolean) : [],
      limitMode: raw?.limitMode === "perdest" ? "perdest" : DEFAULT_CONFIG.limitMode,
      globalLimitMin: finiteNumber(raw?.globalLimitMin, DEFAULT_CONFIG.globalLimitMin),
      safetyLimitMin: finiteNumber(raw?.safetyLimitMin, DEFAULT_CONFIG.safetyLimitMin),
      minPerFieldOverride: finiteNumber(raw?.minPerFieldOverride, DEFAULT_CONFIG.minPerFieldOverride),
      groupId: String(raw?.groupId ?? DEFAULT_CONFIG.groupId),
      resPercent: finiteNumber(raw?.resPercent, DEFAULT_CONFIG.resPercent),
      totalRuntime: runtime,
      cycleInterval: cycle
    };
  }
  function parseDurationMs(value) {
    const match = /^(\d+)(min|h)$/.exec(value);
    if (!match) return 0;
    const amount = parseInt(match[1], 10);
    return match[2] === "h" ? amount * 60 * 60 * 1e3 : amount * 60 * 1e3;
  }
  function parseProductionDocument(doc) {
    const desktop = parseDesktopProduction(doc);
    if (desktop.length > 0) return desktop;
    return parseMobileProduction(doc);
  }
  function parseDesktopProduction(doc) {
    const rows = Array.from(doc.querySelectorAll("#production_table tr.row_a, #production_table tr.row_b"));
    return rows.map(parseDesktopRow).filter(Boolean);
  }
  function parseDesktopRow(row) {
    const vn = row.querySelector(".quickedit-vn");
    const marketLink = row.querySelector('a[href*="screen=market"]');
    const id = attr(vn, "data-id") ?? queryParam(marketLink?.href, "village");
    const coord = normalizeCoord(vn?.textContent ?? row.textContent ?? "");
    if (!id || !coord) return null;
    const [x, y] = coord.split("|").map((n) => parseInt(n, 10));
    const wood = numberText(row.querySelector(".wood")?.textContent);
    const stone = numberText(row.querySelector(".stone")?.textContent);
    const iron = numberText(row.querySelector(".iron")?.textContent);
    const ironCell = row.querySelector(".iron")?.closest("td");
    const warehouse = numberText(ironCell?.nextElementSibling?.textContent);
    const merchants = parseMerchants(marketLink?.closest("td")?.textContent ?? marketLink?.textContent ?? "");
    return { id, name: vn?.textContent?.trim() ?? "", coord, x, y, wood, stone, iron, warehouse, merchants };
  }
  function parseMobileProduction(doc) {
    const woods = Array.from(doc.querySelectorAll(".res.mwood"));
    const stones = Array.from(doc.querySelectorAll(".res.mstone"));
    const irons = Array.from(doc.querySelectorAll(".res.miron"));
    if (woods.length === 0) return [];
    return woods.map((woodEl, i) => {
      const row = woodEl.closest("tr, .village-item, .vis_item") ?? woodEl.parentElement;
      const text = row?.textContent ?? "";
      const link = row?.querySelector('a[href*="screen=market"], a[href*="village="]');
      const coord = normalizeCoord(text);
      const id = queryParam(link?.href, "village") ?? attr(row, "data-id");
      if (!coord || !id) return null;
      const [x, y] = coord.split("|").map((n) => parseInt(n, 10));
      return {
        id,
        name: row?.querySelector(".quickedit-vn")?.textContent?.trim() ?? "",
        coord,
        x,
        y,
        wood: numberText(woodEl.textContent),
        stone: numberText(stones[i]?.textContent),
        iron: numberText(irons[i]?.textContent),
        warehouse: numberText(row?.querySelector(".res_storage, .storage")?.textContent),
        merchants: parseMerchants(row?.querySelector('a[href*="screen=market"]')?.closest("td")?.textContent ?? text)
      };
    }).filter(Boolean);
  }
  function normalizeDestination(raw) {
    const coord = normalizeCoord(raw.coord);
    if (!coord) return null;
    return { coord, limitMin: finiteNumber(raw.limitMin, DEFAULT_CONFIG.globalLimitMin) };
  }
  function normalizeCoord(text) {
    const match = /(\d{3})\|(\d{3})/.exec(text);
    return match ? `${match[1]}|${match[2]}` : null;
  }
  function parseMerchants(text) {
    const match = /(\d+)\s*\/\s*\d+/.exec(text.replace(/\./g, ""));
    return match ? parseInt(match[1], 10) : numberText(text);
  }
  function numberText(text) {
    const cleaned = (text ?? "").replace(/[^\d-]/g, "");
    return cleaned ? parseInt(cleaned, 10) || 0 : 0;
  }
  function finiteNumber(value, fallback) {
    const num = typeof value === "number" ? value : parseFloat(String(value ?? ""));
    return Number.isFinite(num) ? num : fallback;
  }
  function attr(el, name) {
    const value = el?.getAttribute(name);
    return value || void 0;
  }
  function queryParam(href, key) {
    if (!href) return void 0;
    try {
      return new URL(href, window.location.origin).searchParams.get(key) ?? void 0;
    } catch {
      return void 0;
    }
  }
  function distance(ax, ay, bx, by) {
    return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
  }
  function findString(value, keys) {
    if (!value || typeof value !== "object") return null;
    for (const key of keys) {
      const candidate = value[key];
      if (typeof candidate === "string" || typeof candidate === "number") return String(candidate);
    }
    for (const nested of Object.values(value)) {
      const found = findString(nested, keys);
      if (found) return found;
    }
    return null;
  }
  function extractMapSendError(payload) {
    if (!payload || typeof payload !== "object") return null;
    const data = payload;
    if (data.error) return String(data.error);
    if (data.errors) return Array.isArray(data.errors) ? data.errors.join(", ") : String(data.errors);
    return null;
  }
  function withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }
  function delay3(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // src/modules/auto-res-sender/ui.ts
  async function initUi4(ctx, contentEl, service2) {
    const config = await service2.loadConfig();
    const root = document.createElement("div");
    root.className = "ph-ars";
    const destinations = document.createElement("div");
    destinations.className = "ph-ars-dests";
    root.appendChild(section("Destinos", destinations));
    const rows = [];
    function addDestinationRow(dest = { coord: "", limitMin: config.globalLimitMin }) {
      const row = document.createElement("div");
      row.className = "ph-ars-dest-row";
      const coord = input("XXX|YYY");
      coord.className = "ph-ars-input ph-ars-coord";
      coord.value = dest.coord;
      const limit = numberInput(dest.limitMin);
      limit.title = "Limite deste destino em minutos";
      const remove = button("Remover");
      remove.addEventListener("click", () => {
        row.remove();
        const idx = rows.indexOf(row);
        if (idx !== -1) rows.splice(idx, 1);
      });
      row.append(coord, limit, remove);
      rows.push(row);
      destinations.appendChild(row);
    }
    for (const dest of config.destinations) addDestinationRow(dest);
    if (config.destinations.length === 0) addDestinationRow();
    const addDest = button("Adicionar destino");
    addDest.addEventListener("click", () => addDestinationRow());
    destinations.appendChild(addDest);
    const limitsGrid = document.createElement("div");
    limitsGrid.className = "ph-ars-grid";
    const mode = select([
      ["global", "Global"],
      ["perdest", "Por destino"]
    ], config.limitMode);
    const globalLimit = numberInput(config.globalLimitMin);
    const safetyLimit = numberInput(config.safetyLimitMin);
    const minPerField = numberInput(config.minPerFieldOverride);
    minPerField.placeholder = "auto";
    limitsGrid.append(
      field("Modo de limite", mode),
      field("Limite global (min)", globalLimit),
      field("Limite de seguran\xE7a (min)", safetyLimit),
      field("Velocidade mercador (min/campo)", minPerField)
    );
    root.appendChild(section("Limites", limitsGrid));
    const sourceGrid = document.createElement("div");
    sourceGrid.className = "ph-ars-grid";
    const groupId = input("0");
    groupId.value = config.groupId;
    const currentGroup = button("Apanhar grupo atual");
    currentGroup.addEventListener("click", () => {
      groupId.value = new URL(window.location.href).searchParams.get("group") ?? "0";
    });
    const resPercent = numberInput(config.resPercent);
    sourceGrid.append(
      field("ID do grupo", groupId),
      currentGroup,
      field("Manter % no armaz\xE9m", resPercent)
    );
    root.appendChild(section("Origem", sourceGrid));
    const scheduleGrid = document.createElement("div");
    scheduleGrid.className = "ph-ars-grid";
    const totalRuntime = select(RUNTIME_OPTIONS.map((v) => [v, v]), config.totalRuntime);
    const cycleInterval = select(CYCLE_OPTIONS.map((v) => [v, v]), config.cycleInterval);
    scheduleGrid.append(
      field("Tempo total", totalRuntime),
      field("Intervalo entre ciclos", cycleInterval)
    );
    root.appendChild(section("Agenda", scheduleGrid));
    const status = document.createElement("div");
    status.className = "ph-ars-status";
    const save = button("Guardar");
    save.className = "ph-ars-primary";
    save.addEventListener("click", async () => {
      save.disabled = true;
      status.textContent = "";
      await service2.saveConfig(readConfig());
      status.textContent = "Guardado. A recarregar...";
      window.location.reload();
    });
    const actions = document.createElement("div");
    actions.className = "ph-ars-actions";
    actions.append(save, status);
    root.appendChild(actions);
    contentEl.appendChild(root);
    function readConfig() {
      const destinationsConfig = rows.map((row) => ({
        coord: row.querySelector(".ph-ars-coord")?.value.trim() ?? "",
        limitMin: parseNumber(row.querySelectorAll("input")[1]?.value, config.globalLimitMin)
      })).filter((dest) => dest.coord.length > 0);
      return {
        destinations: destinationsConfig,
        limitMode: mode.value === "perdest" ? "perdest" : "global",
        globalLimitMin: parseNumber(globalLimit.value, 120),
        safetyLimitMin: parseNumber(safetyLimit.value, 120),
        minPerFieldOverride: parseNumber(minPerField.value, 0),
        groupId: groupId.value.trim() || "0",
        resPercent: parseNumber(resPercent.value, 0),
        totalRuntime: totalRuntime.value,
        cycleInterval: cycleInterval.value
      };
    }
    return {
      destroy() {
        root.remove();
      }
    };
  }
  function section(label, child) {
    const wrap = document.createElement("div");
    wrap.className = "ph-ars-section";
    const title = document.createElement("div");
    title.className = "ph-ars-label";
    title.textContent = label;
    wrap.append(title, child);
    return wrap;
  }
  function field(label, control) {
    const wrap = document.createElement("label");
    wrap.className = "ph-ars-field";
    const span = document.createElement("span");
    span.textContent = label;
    wrap.append(span, control);
    return wrap;
  }
  function input(placeholder) {
    const el = document.createElement("input");
    el.className = "ph-ars-input";
    el.type = "text";
    el.placeholder = placeholder;
    return el;
  }
  function numberInput(value) {
    const el = input("");
    el.type = "number";
    el.min = "0";
    el.value = value > 0 ? String(value) : "";
    return el;
  }
  function select(options, value) {
    const el = document.createElement("select");
    el.className = "ph-ars-input";
    for (const [val, label] of options) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      el.appendChild(opt);
    }
    el.value = value;
    return el;
  }
  function button(label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ph-ars-btn";
    btn.textContent = label;
    return btn;
  }
  function parseNumber(value, fallback) {
    const parsed = parseFloat(value ?? "");
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  // src/modules/auto-res-sender/index.ts
  var service = null;
  var cleanupUi3 = null;
  var autoResSenderModule = {
    manifest: manifest4,
    async init(ctx) {
      if (!service) service = new AutoResSenderService(ctx);
      if (ctx.hubContent) {
        cleanupUi3?.();
        const ui = await initUi4(ctx, ctx.hubContent, service);
        cleanupUi3 = ui.destroy;
        return;
      }
      await service.start();
    },
    disposeUi() {
      cleanupUi3?.();
      cleanupUi3 = null;
    },
    destroy() {
      this.disposeUi?.();
      void service?.stop();
      service = null;
    }
  };
  var auto_res_sender_default = autoResSenderModule;

  // src/bootstrap.ts
  async function boot() {
    const gameData = createGameDataService();
    const gd = gameData.snapshot();
    if (!gd) return;
    const state = createStateStore();
    const eventBus = createEventBus();
    const storage = createStorageService();
    const logger = createLogger();
    const services = {
      gameData,
      logger,
      storage,
      windows: createWindowManager(storage),
      request: createRequestService(gameData),
      scheduler: createSchedulerService(storage),
      worldConfig: createWorldConfigService(gameData, storage),
      keepAlive: createKeepAliveService(logger.scoped("keep-alive"))
    };
    const registry = createRegistry({ state, eventBus, services });
    registry.register(status_overview_default);
    registry.register(notas_manuais_default);
    registry.register(renomear_cores_default);
    registry.register(auto_res_sender_default);
    await bootShell(registry, services, state, eventBus, gd.screen);
  }
  void boot();
})();
