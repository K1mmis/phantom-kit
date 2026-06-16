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

  // src/core/registry.ts
  function createRegistry() {
    const manifests = [];
    const active = [];
    return {
      register(manifest2) {
        manifests.push(manifest2);
      },
      async init(screen) {
        const context = {
          state: createStateStore(),
          eventBus: createEventBus()
        };
        for (const m of manifests) {
          if (m.allowedScreens.includes(screen)) {
            await m.init(context);
            active.push(m);
          }
        }
      },
      destroy() {
        for (const m of active) m.destroy();
        active.length = 0;
      }
    };
  }

  // src/game/game-data.ts
  function getGameData() {
    const raw = window.game_data;
    if (!raw || typeof raw.screen !== "string") return null;
    return JSON.parse(JSON.stringify(raw));
  }

  // src/modules/status-overview/manifest.ts
  var manifest = {
    id: "status-overview",
    name: "Status Overview",
    version: "0.1.0",
    allowedScreens: ["overview"]
  };

  // src/modules/status-overview/service.ts
  var READY_EVENT = "statusOverview:ready";
  function initService(context) {
    const gd = getGameData();
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
  async function init(context) {
    initService(context);
    const ui = await initUi(context);
    cleanupUi = ui.destroy;
  }
  function destroy() {
    cleanupUi?.();
    cleanupUi = null;
  }

  // src/bootstrap.ts
  async function boot() {
    const gd = getGameData();
    if (!gd) return;
    const registry = createRegistry();
    registry.register({ ...manifest, init, destroy });
    await registry.init(gd.screen);
  }
  void boot();
})();
