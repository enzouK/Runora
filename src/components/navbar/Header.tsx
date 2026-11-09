import React from 'react';
import { AlertCircle, Layers, Library, Puzzle, RefreshCw, Search, Settings } from 'lucide-react';
import runoraTextLight from '../../assets/runora-text-allblack.png';
import runoraTextDark from '../../assets/runora-text-allwhite.png';
import runoraIconWhite from '../../assets/runora-icon-white.png';

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
  /** Quantos itens estão em disputa esperando decisão (badge no botão). */
  syncPending?: number;
  /** Há mudanças aqui que ainda não foram para o Drive (botão amarelo). */
  syncDirty?: boolean;
}

const TABS: { id: MainNavTab; label: string; icon: React.ReactNode }[] = [
  { id: 'decks', label: 'Decks', icon: <Library className="w-3.5 h-3.5" /> },
  { id: 'browser', label: 'Painel', icon: <Search className="w-3.5 h-3.5" /> },
  { id: 'notetypes', label: 'Note Types', icon: <Layers className="w-3.5 h-3.5" /> },
  { id: 'addons', label: 'Addons', icon: <Puzzle className="w-3.5 h-3.5" /> },
];

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  onOpenSettings,
  onSync,
  syncRunning,
  syncPending = 0,
  syncDirty = false,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full bg-ios-bg/85 dark:bg-ios-bg-dark/80 backdrop-blur-xl border-b border-black/[0.07] dark:border-white/[0.08]">
      <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between gap-3">
        {/* Brand — flex-1 wrapper centers it exactly in the space between the
            left edge and the start of the Decks control; clicking it (the text)
            navigates back to the home page (Decks). */}
        <button
          type="button"
          onClick={() => onTabChange('decks')}
          aria-label="Runora — voltar para a página inicial (Decks)"
          title="Voltar para a página inicial"
          className="flex-1 flex items-center justify-center gap-2 select-none min-w-0 overflow-hidden cursor-pointer transition-opacity hover:opacity-80 active:opacity-60"
        >
          <img
            src={runoraIconWhite}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 object-contain shrink-0"
          />
          <img
            src={runoraTextLight}
            alt="Runora"
            draggable={false}
            className="h-8 sm:h-10 md:h-12 w-auto object-contain dark:hidden truncate max-w-[60vw] sm:max-w-[70vw] md:max-w-none"
          />
          <img
            src={runoraTextDark}
            alt="Runora"
            draggable={false}
            className="h-8 sm:h-10 md:h-12 w-auto object-contain hidden dark:block truncate max-w-[60vw] sm:max-w-[70vw] md:max-w-none"
          />
        </button>

        {/* iOS Segmented Control + Sync action button (right next to Addons) */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center rounded-[10px] bg-black/[0.06] dark:bg-white/[0.08] p-[2px]">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-[7px] rounded-[8px] text-[13px] font-semibold transition-all active:scale-[0.97] ${
                  activeTab === tab.id
                    ? 'bg-ios-card dark:bg-[#636366] text-zinc-900 dark:text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]'
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
            title={
              syncPending > 0
                ? `${syncPending} ${syncPending === 1 ? 'item mudou' : 'itens mudaram'} nos dois lados — toque para resolver`
                : syncDirty
                  ? 'Você tem mudanças que ainda não foram para o Drive — toque para sincronizar'
                  : 'Sincronizar agora com o Google Drive'
            }
            className={`relative flex items-center gap-1.5 px-3 py-[7px] rounded-[10px] text-[13px] font-semibold transition-all active:scale-[0.97] disabled:opacity-50 ${
              syncDirty
                ? 'text-amber-600 dark:text-amber-400 bg-amber-500/15 hover:bg-amber-500/25'
                : 'text-ios-blue bg-ios-blue/10 hover:bg-ios-blue/20'
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncRunning ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{syncRunning ? 'Sincronizando…' : 'Sync'}</span>
            {syncPending > 0 ? (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white dark:border-zinc-900">
                {syncPending > 99 ? '99+' : syncPending}
              </span>
            ) : syncDirty ? (
              <span className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] rounded-full bg-amber-500 flex items-center justify-center border-2 border-white dark:border-zinc-900">
                <AlertCircle className="w-3 h-3 text-white" />
              </span>
            ) : null}
          </button>
        </div>

        {/* Right Actions */}
        <div className="flex items-center justify-end gap-1.5 shrink-0">
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
