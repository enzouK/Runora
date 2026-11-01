import React from 'react';
import { Layers, Library, Puzzle, RefreshCw, Search, Settings } from 'lucide-react';
import runoraIcon from '../../assets/runora-icon.png';
import runoraText from '../../assets/runora-text.png';
// Recolored (deep purple) variants for light mode — the originals are made for
// dark backgrounds and are nearly invisible on the light theme.
import runoraIconLight from '../../assets/runora-icon-light.png';
import runoraTextLight from '../../assets/runora-text-light.png';

export type MainNavTab = 'decks' | 'browser' | 'notetypes' | 'addons';

interface HeaderProps {
  activeTab: MainNavTab;
  onTabChange: (tab: MainNavTab) => void;
  onOpenAddCard: () => void;
  onOpenSettings: () => void;
  onNewDeck: () => void;
  /** Runs a Google Drive sync immediately (button next to the Addons tab). */
  onSync: () => void;
  syncRunning: boolean;
}

const TABS: { id: MainNavTab; label: string; icon: React.ReactNode }[] = [
  { id: 'decks', label: 'Decks', icon: <Library className="w-3.5 h-3.5" /> },
  { id: 'browser', label: 'Painel', icon: <Search className="w-3.5 h-3.5" /> },
  { id: 'notetypes', label: 'Note Types', icon: <Layers className="w-3.5 h-3.5" /> },
  { id: 'addons', label: 'Addons', icon: <Puzzle className="w-3.5 h-3.5" /> },
];

export const Header: React.FC<HeaderProps> = ({ activeTab, onTabChange, onOpenSettings, onSync, syncRunning }) => {
  return (
    <header className="sticky top-0 z-40 w-full bg-ios-bg/85 dark:bg-ios-bg-dark/80 backdrop-blur-xl border-b border-black/[0.07] dark:border-white/[0.08]">
      <div className="max-w-4xl mx-auto px-4 h-16 flex items-center">
        {/* Brand — flex-1 wrapper centers it exactly in the space between the
            left edge and the start of the Decks control; clicking it (either
            the icon or the text) navigates back to the home page (Decks). */}
        <button
          type="button"
          onClick={() => onTabChange('decks')}
          aria-label="Runora — voltar para a página inicial (Decks)"
          title="Voltar para a página inicial"
          className="flex-1 flex items-center justify-center gap-2 select-none min-w-0 cursor-pointer transition-opacity hover:opacity-80 active:opacity-60"
        >
          {/* Original (dark-optimized) and light-mode variant, swapped by theme */}
          <img
            src={runoraIcon}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="w-11 h-11 object-contain shrink-0 dark:block hidden"
          />
          <img
            src={runoraIconLight}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="w-11 h-11 object-contain shrink-0 dark:hidden"
          />
          <img
            src={runoraText}
            alt="Runora"
            draggable={false}
            className="h-10 w-auto object-contain dark:block hidden"
          />
          <img
            src={runoraTextLight}
            alt="Runora"
            draggable={false}
            className="h-10 w-auto object-contain dark:hidden"
          />
        </button>

        {/* iOS Segmented Control + Sync action button (right next to Addons) */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-[10px] bg-black/[0.06] dark:bg-white/[0.08] p-[2px]">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-[7px] rounded-[8px] text-[13px] font-semibold transition-all active:scale-[0.97] ${
                  activeTab === tab.id
                    ? 'bg-white dark:bg-[#636366] text-zinc-900 dark:text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                {tab.icon}
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onSync}
            disabled={syncRunning}
            title="Sincronizar agora com o Google Drive"
            className="flex items-center gap-1.5 px-3 py-[7px] rounded-[10px] text-[13px] font-semibold text-ios-blue bg-ios-blue/10 hover:bg-ios-blue/20 transition-all active:scale-[0.97] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncRunning ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Sync</span>
          </button>
        </div>

        {/* Right Actions */}
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={onOpenSettings}
            className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] hover:text-zinc-800 dark:hover:text-zinc-100 transition-colors"
            title="Configurações"
          >
            <Settings className="w-[19px] h-[19px]" />
          </button>
        </div>
      </div>
    </header>
  );
};
