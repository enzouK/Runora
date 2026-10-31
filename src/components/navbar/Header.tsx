import React from 'react';
import { Layers, Library, Puzzle, RefreshCw, Search, Settings } from 'lucide-react';

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

/** Custom flashcard-stack logo (two overlapping cards, iOS-gradient) */
const FlashcardLogo: React.FC = () => (
  <svg
    viewBox="0 0 40 40"
    className="w-9 h-9 drop-shadow-[0_2px_6px_rgba(0,122,255,0.35)]"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="anki-logo-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#4aa8ff" />
        <stop offset="100%" stopColor="#0064d2" />
      </linearGradient>
    </defs>
    {/* Back card, slightly tilted */}
    <rect
      x="8"
      y="4"
      width="24"
      height="18"
      rx="5.5"
      fill="url(#anki-logo-grad)"
      opacity="0.45"
      transform="rotate(-7 20 13)"
    />
    {/* Front card */}
    <rect x="7" y="13" width="26" height="22" rx="6" fill="url(#anki-logo-grad)" />
    {/* Content hint lines */}
    <rect x="12" y="19" width="16" height="3.2" rx="1.6" fill="#ffffff" opacity="0.95" />
    <rect x="12" y="25" width="10" height="3.2" rx="1.6" fill="#ffffff" opacity="0.55" />
  </svg>
);

const TABS: { id: MainNavTab; label: string; icon: React.ReactNode }[] = [
  { id: 'decks', label: 'Decks', icon: <Library className="w-3.5 h-3.5" /> },
  { id: 'browser', label: 'Painel', icon: <Search className="w-3.5 h-3.5" /> },
  { id: 'notetypes', label: 'Note Types', icon: <Layers className="w-3.5 h-3.5" /> },
  { id: 'addons', label: 'Addons', icon: <Puzzle className="w-3.5 h-3.5" /> },
];

export const Header: React.FC<HeaderProps> = ({ activeTab, onTabChange, onOpenSettings, onSync, syncRunning }) => {
  return (
    <header className="sticky top-0 z-40 w-full bg-ios-bg/85 dark:bg-ios-bg-dark/80 backdrop-blur-xl border-b border-black/[0.07] dark:border-white/[0.08]">
      <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2.5 select-none">
          <FlashcardLogo />
          <div className="flex flex-col items-center leading-none">
            <span className="font-bold text-[19px] tracking-tight text-zinc-900 dark:text-white leading-none">
              Anki
            </span>
            <span className="mt-[2px] bg-gradient-to-br from-[#4aa8ff] to-[#0064d2] bg-clip-text text-transparent font-extrabold text-[16px] tracking-tight leading-none">
              2.0
            </span>
          </div>
        </div>

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
        <div className="flex items-center gap-1.5">
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
