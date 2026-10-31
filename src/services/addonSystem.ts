/**
 * Anki 2.0 Addon Architecture
 * Provides standard JavaScript hooks to extend review UI, card rendering, and shortcuts,
 * ensuring 100% cross-platform parity on Windows 11 and Android.
 *
 * Addons live in the on-device "Addons" folder (see addonFs.ts):
 *   Addons/<id>/manifest.json   -> AddonManifest
 *   Addons/<id>/main.js         -> JavaScript executed at startup when enabled
 *
 * While a main.js runs, every Anki2Addons.addHook() call is attributed to that
 * addon id, so hooks can be removed when the addon is disabled/deleted.
 */

import { listAddons, setAddonEnabled } from './addonStorage';
import { getAddonFs } from './addonFs';

export interface AddonManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  description: string;
  enabled: boolean;
  script?: string;
}

export type AddonHookType =
  | 'beforeCardRender'
  | 'afterCardRender'
  | 'beforeReviewSubmit'
  | 'afterReviewSubmit'
  | 'onDeckSelect';

export type AddonHookCallback = (context: Record<string, unknown>) => unknown;

interface HookEntry {
  /** Addon id that registered the callback (null = built into the app). */
  owner: string | null;
  callback: AddonHookCallback;
}

export class AddonSystem {
  private static hooks: Map<AddonHookType, HookEntry[]> = new Map();
  private static registeredAddons: AddonManifest[] = [];
  private static loaded = false;
  /** Addon whose main.js is currently executing (hooks register to it). */
  private static currentOwner: string | null = null;
  /** Serializes script load/unload so concurrent refresh/toggle calls don't interleave. */
  private static scriptChain: Promise<void> = Promise.resolve();

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

  /**
   * App-start initialization: makes sure the Addons folder exists (so users can
   * drop addon folders manually) and loads installed addons. Returns the
   * absolute folder path when the backend exposes one (desktop/Android).
   */
  public static async init(): Promise<string | null> {
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
   * the callback is attributed to that addon (so it can be unloaded later).
   */
  public static addHook(hook: AddonHookType, callback: AddonHookCallback): void {
    if (!this.hooks.has(hook)) {
      this.hooks.set(hook, []);
    }
    this.hooks.get(hook)!.push({ owner: this.currentOwner, callback });
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
        if (result && typeof result === 'object') {
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
  }

  /** Executes the main.js of a single addon, attributing its hooks to it. */
  private static async executeAddonScript(addon: AddonManifest): Promise<void> {
    try {
      const fs = await getAddonFs();
      const entry = await fs.read(`${addon.id}/main.js`, 'utf8').catch(() => null);
      if (!entry) return; // addon without script (manifest-only) is fine
      this.currentOwner = addon.id;
      try {
        // No CSP is set (dev, packaged Electron and Capacitor WebView all allow
        // dynamic code), so new Function is available on every channel.
        const run = new Function('Anki2Addons', `'use strict';\n${entry.data}`) as (api: unknown) => void;
        run(AddonSystem);
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

// Expose on window for runtime JavaScript addons
if (typeof window !== 'undefined') {
  (window as unknown as { Anki2Addons: typeof AddonSystem }).Anki2Addons = AddonSystem;
  // Create the Addons folder at startup and load installed addons.
  void AddonSystem.init();
}
