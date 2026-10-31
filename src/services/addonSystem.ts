/**
 * Anki 2.0 Addon Architecture
 * Provides standard JavaScript hooks to extend review UI, card rendering, and shortcuts,
 * ensuring 100% cross-platform parity on Windows 11 and Android.
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

export class AddonSystem {
  private static hooks: Map<AddonHookType, AddonHookCallback[]> = new Map();
  private static registeredAddons: AddonManifest[] = [];
  private static loaded = false;

  /** Reloads the addon list from the on-device Addons folder + settings.json. */
  public static async refresh(): Promise<void> {
    try {
      this.registeredAddons = await listAddons();
      this.loaded = true;
    } catch (err) {
      console.error('Failed to load addons from Addons folder:', err);
    }
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
   * Register a hook callback
   */
  public static addHook(hook: AddonHookType, callback: AddonHookCallback): void {
    if (!this.hooks.has(hook)) {
      this.hooks.set(hook, []);
    }
    this.hooks.get(hook)!.push(callback);
  }

  /**
   * Run all callbacks registered for a hook
   */
  public static runHook(hook: AddonHookType, context: Record<string, unknown>): Record<string, unknown> {
    const callbacks = this.hooks.get(hook) || [];
    let currentCtx = { ...context };

    for (const cb of callbacks) {
      try {
        const result = cb(currentCtx);
        if (result && typeof result === 'object') {
          currentCtx = { ...currentCtx, ...(result as Record<string, unknown>) };
        }
      } catch (err) {
        console.error(`Addon hook execution error [${hook}]:`, err);
      }
    }

    return currentCtx;
  }

  public static getAddons(): AddonManifest[] {
    return [...this.registeredAddons];
  }

  public static toggleAddon(id: string): void {
    this.registeredAddons = this.registeredAddons.map((a) =>
      a.id === id ? { ...a, enabled: !a.enabled } : a
    );
    const next = this.registeredAddons.find((a) => a.id === id)?.enabled;
    if (typeof next === 'boolean') {
      void setAddonEnabled(id, next).catch((err) => {
        console.error('Failed to persist addon enabled state:', err);
      });
    }
  }
}

// Expose on window for runtime JavaScript addons
if (typeof window !== 'undefined') {
  (window as unknown as { Anki2Addons: typeof AddonSystem }).Anki2Addons = AddonSystem;
  // Create the Addons folder at startup and load installed addons.
  void AddonSystem.init();
}
