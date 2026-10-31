import React from 'react';
import { Puzzle, Sparkles } from 'lucide-react';
import { AddonSystem } from '../../services/addonSystem';
import { IOSSwitch } from '../common/IOSSwitch';

/**
 * Addons JS — full-page view (accessible from the main nav, next to Note Types).
 * Lists installed addons and lets the user enable/disable them.
 */
export const AddonsView: React.FC = () => {
  const [addons, setAddons] = React.useState(() => AddonSystem.getAddons());

  const handleToggle = (id: string) => {
    AddonSystem.toggleAddon(id);
    setAddons(AddonSystem.getAddons());
  };

  return (
    <div className="space-y-6 ios-fade-in">
      {/* Large Title header */}
      <div className="flex items-end justify-between gap-4 px-1 pt-1">
        <div>
          <h2 className="text-[32px] leading-none font-bold tracking-tight text-zinc-900 dark:text-white">
            Addons
          </h2>
          <p className="text-[15px] text-zinc-500 dark:text-zinc-400 mt-1.5">
            Plugins em JavaScript para estender o app.
          </p>
        </div>

        <button
          type="button"
          title="Instalar Addon (em breve)"
          disabled
          className="w-9 h-9 rounded-full flex items-center justify-center bg-ios-blue/30 text-white cursor-not-allowed"
        >
          <Puzzle className="w-[18px] h-[18px]" strokeWidth={2.5} />
        </button>
      </div>

      {/* System description */}
      <div className="p-4 rounded-[16px] bg-purple-500/10 text-[13px] text-purple-900 dark:text-purple-200">
        <span className="font-bold flex items-center gap-1.5 mb-1 text-purple-600 dark:text-purple-300">
          <Sparkles className="w-4 h-4" />
          Sistema de Addons em JavaScript
        </span>
        Arquitetura preparada para plugins em JS multiplataforma (Windows 11 e Android). O sistema
        expõe ganchos como <code>beforeCardRender</code> e <code>afterReviewSubmit</code> via{' '}
        <code>window.Anki2Addons</code>.
      </div>

      {/* Addon list (iOS inset grouped) */}
      <div className="rounded-[20px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden divide-y divide-black/[0.05] dark:divide-white/[0.06]">
        {addons.length === 0 ? (
          <div className="p-8 text-center">
            <Puzzle className="w-8 h-8 mx-auto text-zinc-300 dark:text-zinc-600 mb-3" />
            <p className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400">
              Nenhum addon instalado
            </p>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">
              Os addons aparecerão aqui quando instalados — a instalação será a próxima etapa do
              sistema.
            </p>
          </div>
        ) : (
          addons.map((addon) => (
            <div key={addon.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-zinc-900 dark:text-zinc-100">
                    {addon.name}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/[0.05] dark:bg-white/[0.1] text-zinc-500 dark:text-zinc-400">
                    v{addon.version}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {addon.description}
                </p>
              </div>

              <IOSSwitch checked={addon.enabled} onChange={() => handleToggle(addon.id)} />
            </div>
          ))
        )}
      </div>
    </div>
  );
};
