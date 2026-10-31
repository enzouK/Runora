/**
 * Runora Addon Architecture
 * Provides standard JavaScript hooks to extend review UI, card rendering, and shortcuts,
 * ensuring 100% cross-platform parity on Windows 11 and Android.
 *
 * Addons live in the on-device "Addons" folder (see addonFs.ts):
 *   Addons/<id>/manifest.json   -> AddonManifest
 *   Addons/<id>/main.js         -> JavaScript executed at startup when enabled
 *
 * While a main.js runs, every RunoraAddons.addHook() call is attributed to that
 * addon id, so hooks can be removed when the addon is disabled/deleted.
 */

import { listAddons, setAddonEnabled, readAddonConfig, writeAddonConfig, readAddonData, writeAddonData } from './addonStorage';
import { getAddonFs } from './addonFs';
import pkg from '../../package.json';

/** App version (from package.json) used for manifest minAppVersion checks. */
export const APP_VERSION: string = pkg.version;

export interface AddonConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'color' | 'select';
  default?: unknown;
  /** Options for type 'select'. */
  options?: string[];
  description?: string;
}

export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  description: string;
  enabled: boolean;
  script?: string;
  /** Minimum app version required to run this addon. */
  minAppVersion?: string;
  /** Declarative settings schema — rendered by the in-app Configurações button. */
  configSchema?: AddonConfigField[];
}

/** Simple semver-ish check: is `have` >= `need`? */
export function versionAtLeast(have: string, need: string): boolean {
  const parse = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const a = parse(have);
  const b = parse(need);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export type AddonHookType =
  | 'beforeCardRender'
  | 'afterCardRender'
  | 'beforeReviewSubmit'
  | 'afterReviewSubmit'
  | 'onDeckSelect'
  | 'onAppStart'
  | 'onNoteSaved'
  | 'onDeckCreated'
  | 'onDeckDeleted';

export type AddonHookCallback = (context: Record<string, unknown>) => unknown;

interface HookEntry {
  /** Addon id that registered the callback (null = built into the app). */
  owner: string | null;
  callback: AddonHookCallback;
}

export class AddonSystem {
  /** App version exposed to addon scripts (window.RunoraAddons.APP_VERSION). */
  public static readonly APP_VERSION: string = pkg.version;

  private static hooks: Map<AddonHookType, HookEntry[]> = new Map();
  private static registeredAddons: AddonManifest[] = [];
  private static loaded = false;
  /** Addon whose main.js is currently executing (hooks register to it). */
  private static currentOwner: string | null = null;
  /** Serializes script load/unload so concurrent refresh/toggle calls don't interleave. */
  private static scriptChain: Promise<void> = Promise.resolve();
  /** Cached config.json contents per addon id (loaded before scripts run). */
  private static configCache: Map<string, Record<string, unknown>> = new Map();
  /** Cached data.json contents per addon id. */
  private static dataCache: Map<string, Record<string, unknown>> = new Map();
  /** onConfigChange listeners per addon id. */
  private static configListeners: Map<string, Array<(config: Record<string, unknown>) => void>> = new Map();

  /** Reloads the addon list from the on-device Addons folder + settings.json and re-runs enabled scripts. */
  public static async refresh(): Promise<void> {
    try {
      this.registeredAddons = await listAddons();
      this.loaded = true;
    } catch (err) {
      console.error('Failed to load addons from Addons folder:', err);
    }
    await this.reloadScripts();
  }

  private static initPromise: Promise<string | null> | null = null;

  /**
   * App-start initialization: makes sure the Addons folder exists (so users can
   * drop addon folders manually) and loads installed addons. Memoized — every
   * caller gets the same promise, so e.g. the app shell can await it before
   * firing the onAppStart hook. Returns the absolute folder path when the
   * backend exposes one (desktop/Android).
   */
  public static init(): Promise<string | null> {
    if (!this.initPromise) this.initPromise = this.doInit();
    return this.initPromise;
  }

  private static async doInit(): Promise<string | null> {
    let root: string | null = null;
    try {
      const fs = await getAddonFs();
      await fs.ensureAddonsDir();
      root = await fs.rootPath();
    } catch (err) {
      console.error('Failed to ensure Addons folder:', err);
    }
    await this.refresh();
    return root;
  }

  /**
   * Register a hook callback. When called from inside an addon's main.js,
   * the callback is attributed to that addon (so it can be unloaded later),
   * and currentOwner stays set while the callback runs (so getConfig/getData/
   * log/toast inside the hook know which addon is calling).
   */
  public static addHook(hook: AddonHookType, callback: AddonHookCallback): void {
    if (!this.hooks.has(hook)) {
      this.hooks.set(hook, []);
    }
    const owner = this.currentOwner;
    const wrapped: AddonHookCallback = owner
      ? (ctx) => {
          const prev = AddonSystem.currentOwner;
          AddonSystem.currentOwner = owner;
          // Async callbacks: keep the owner set until the returned promise
          // settles. Restoring synchronously (finally) would drop attribution
          // right after the first `await`, so getConfig/getData/setData/toast
          // called later in an async hook would see currentOwner = null.
          const restore = () => {
            if (AddonSystem.currentOwner === owner) AddonSystem.currentOwner = prev;
          };
          try {
            const result = callback(ctx);
            if (result && typeof (result as Promise<unknown>).then === 'function') {
              return (result as Promise<unknown>).then(
                (value) => {
                  restore();
                  return value;
                },
                (err) => {
                  restore();
                  throw err;
                }
              );
            }
            restore();
            return result;
          } catch (err) {
            restore();
            throw err;
          }
        }
      : callback;
    this.hooks.get(hook)!.push({ owner, callback: wrapped });
  }

  /**
   * Run all callbacks registered for a hook. Each callback receives the context
   * and may return an object whose keys are merged back into the context.
   */
  public static runHook(hook: AddonHookType, context: Record<string, unknown>): Record<string, unknown> {
    const entries = this.hooks.get(hook) || [];
    let currentCtx = { ...context };

    for (const entry of entries) {
      try {
        const result = entry.callback(currentCtx);
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          // Async hook: log rejections instead of leaving them unhandled.
          void (result as Promise<unknown>).catch((err) => {
            console.error(`Addon hook async error [${hook}] (addon: ${entry.owner ?? 'builtin'}):`, err);
          });
        } else if (result && typeof result === 'object') {
          currentCtx = { ...currentCtx, ...(result as Record<string, unknown>) };
        }
      } catch (err) {
        console.error(`Addon hook execution error [${hook}] (addon: ${entry.owner ?? 'builtin'}):`, err);
      }
    }

    return currentCtx;
  }

  /** Number of registered callbacks for a hook (useful for diagnostics/tests). */
  public static getHookCount(hook: AddonHookType): number {
    return (this.hooks.get(hook) || []).length;
  }

  /** Removes every hook registered by the given addon. */
  public static removeAddonHooks(addonId: string): void {
    for (const [hook, entries] of this.hooks) {
      this.hooks.set(hook, entries.filter((e) => e.owner !== addonId));
    }
    this.configListeners.delete(addonId);
  }

  /* ── Per-addon API exposed to addon scripts (window.RunoraAddons) ─────── */

  /** Reads this addon's config (config.json merged with configSchema defaults). */
  public static getConfig(key?: string): unknown {
    const owner = this.currentOwner;
    if (!owner) return key === undefined ? {} : undefined;
    const cfg = this.configCache.get(owner) || {};
    return key === undefined ? { ...cfg } : cfg[key];
  }

  /** Current config of any addon — used by the in-app Configurações UI. */
  public static getAddonConfig(addonId: string): Record<string, unknown> {
    return { ...(this.configCache.get(addonId) || {}) };
  }

  /** Registers a listener fired when this addon's config changes (from the app UI). */
  public static onConfigChange(callback: (config: Record<string, unknown>) => void): void {
    const owner = this.currentOwner;
    if (!owner) return;
    if (!this.configListeners.has(owner)) this.configListeners.set(owner, []);
    this.configListeners.get(owner)!.push(callback);
  }

  /** Persists new config values for an addon and notifies its onConfigChange listeners. */
  public static async updateConfig(addonId: string, config: Record<string, unknown>): Promise<void> {
    await writeAddonConfig(addonId, config);
    const merged = { ...config };
    this.configCache.set(addonId, merged);
    for (const cb of this.configListeners.get(addonId) || []) {
      try {
        cb({ ...merged });
      } catch (err) {
        console.error(`Addon onConfigChange error [${addonId}]:`, err);
      }
    }
  }

  /** Reads this addon's persisted key-value data (data.json). */
  public static getData(): Record<string, unknown> {
    const owner = this.currentOwner;
    if (!owner) return {};
    return { ...(this.dataCache.get(owner) || {}) };
  }

  /** Replaces this addon's persisted key-value data (data.json). */
  public static async setData(data: Record<string, unknown>): Promise<void> {
    const owner = this.currentOwner;
    if (!owner) throw new Error('RunoraAddons.setData() só pode ser chamado de dentro de um addon');
    const next = { ...data };
    await writeAddonData(owner, next);
    this.dataCache.set(owner, next);
  }

  /** Shows the app-wide toast with this addon's name as prefix. */
  public static toast(message: string): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('runora:addon-toast', { detail: { addonId: this.currentOwner, message } })
      );
    }
  }

  /** console.log prefixed with the calling addon's id. */
  public static log(...args: unknown[]): void {
    console.log(`[addon:${this.currentOwner ?? 'app'}]`, ...args);
  }

  /** Executes the main.js of a single addon, attributing its hooks to it. */
  private static async executeAddonScript(addon: AddonManifest): Promise<void> {
    if (addon.minAppVersion && !versionAtLeast(APP_VERSION, addon.minAppVersion)) {
      console.warn(
        `Addon "${addon.name}" (${addon.id}) requires app >= ${addon.minAppVersion} but app is ${APP_VERSION}; skipping.`
      );
      return;
    }
    try {
      const fs = await getAddonFs();
      const entry = await fs.read(`${addon.id}/main.js`, 'utf8').catch(() => null);
      if (!entry) return; // addon without script (manifest-only) is fine
      this.currentOwner = addon.id;
      try {
        // No CSP is set (dev, packaged Electron and Capacitor WebView all allow
        // dynamic code), so new Function is available on every channel.
        // Both names are passed so legacy addons (Anki2Addons.xxx) keep working
        const run = new Function('RunoraAddons', 'Anki2Addons', `'use strict';\n${entry.data}`) as (
          api: unknown,
          legacyApi: unknown
        ) => void;
        run(AddonSystem, AddonSystem);
      } finally {
        this.currentOwner = null;
      }
    } catch (err) {
      console.error(`Failed to execute addon script [${addon.id}] (${addon.name}):`, err);
    }
  }

  /** Removes the addon's hooks and re-executes its main.js (idempotent). */
  private static async loadAddon(addon: AddonManifest): Promise<void> {
    this.removeAddonHooks(addon.id);
    await this.executeAddonScript(addon);
  }

  /** Drops all addon-owned hooks and re-executes main.js of every enabled addon. */
  public static reloadScripts(): Promise<void> {
    this.scriptChain = this.scriptChain.then(async () => {
      for (const [hook, entries] of this.hooks) {
        this.hooks.set(hook, entries.filter((e) => e.owner === null));
      }
      for (const addon of this.registeredAddons) {
        // load per-addon config/data caches before running any script
        try {
          this.configCache.set(addon.id, await readAddonConfig(addon.id));
          this.dataCache.set(addon.id, await readAddonData(addon.id));
        } catch (err) {
          console.error(`Failed to load config/data for addon [${addon.id}]:`, err);
        }
        if (!addon.enabled) continue;
        await this.loadAddon(addon);
      }
    });
    return this.scriptChain;
  }

  public static getAddons(): AddonManifest[] {
    return [...this.registeredAddons];
  }

  public static toggleAddon(id: string): void {
    this.registeredAddons = this.registeredAddons.map((a) =>
      a.id === id ? { ...a, enabled: !a.enabled } : a
    );
    const addon = this.registeredAddons.find((a) => a.id === id);
    if (!addon || typeof addon.enabled !== 'boolean') return;
    const next = addon.enabled;
    void setAddonEnabled(id, next).catch((err) => {
      console.error('Failed to persist addon enabled state:', err);
    });
    if (next) {
      // enable: (re)run this addon's script
      this.scriptChain = this.scriptChain.then(() => this.loadAddon(addon));
    } else {
      // disable: drop its hooks immediately
      this.removeAddonHooks(id);
    }
  }
}

// Expose on window for runtime JavaScript addons. RunoraAddons is the primary
// name; Anki2Addons stays as a legacy alias so already-installed addons keep working.
if (typeof window !== 'undefined') {
  const w = window as unknown as { RunoraAddons?: typeof AddonSystem; Anki2Addons?: typeof AddonSystem };
  w.RunoraAddons = AddonSystem;
  w.Anki2Addons = AddonSystem;
  // Create the Addons folder at startup and load installed addons.
  void AddonSystem.init();
}
