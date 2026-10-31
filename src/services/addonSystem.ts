/**
 * Anki 2.0 Addon Architecture
 * Provides standard JavaScript hooks to extend review UI, card rendering, and shortcuts,
 * ensuring 100% cross-platform parity on Windows 11 and Android.
 */

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
  }
}

// Expose on window for runtime JavaScript addons
if (typeof window !== 'undefined') {
  (window as unknown as { Anki2Addons: typeof AddonSystem }).Anki2Addons = AddonSystem;
}
