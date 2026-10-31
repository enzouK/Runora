import React, { useState } from 'react';
import {
  X,
  Clock,
  RotateCcw,
  Check,
  AlertCircle,
} from 'lucide-react';
import { FSRSParameters } from '../../types/anki';
import { StorageService } from '../../services/storage';
import { ExportImportService } from '../../services/exportImport';
import { DEFAULT_FSRS_PARAMETERS } from '../../fsrs/constants';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { IOSSelect } from '../common/IOSSelect';
import { COLOR_THEMES, COLOR_THEME_NAMES, DEFAULT_COLOR_THEME } from '../../themes';
import { Sun, Moon, Monitor, Palette } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState<'fsrs'>('fsrs');
  const [params, setParams] = useState<FSRSParameters>(() => StorageService.getFSRSSettings());
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [confirmResetFSRS, setConfirmResetFSRS] = useState(false);
  const [confirmResetData, setConfirmResetData] = useState(false);
  const [rolloverHour, setRolloverHour] = useState<number>(() => StorageService.getRolloverHour());
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => StorageService.getTheme());
  const [colorTheme, setColorTheme] = useState<string>(() => StorageService.getColorTheme());

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    StorageService.setTheme(newTheme);
    const root = document.documentElement;
    if (newTheme === 'dark' || (newTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  };

  const handleColorThemeChange = (id: string) => {
    setColorTheme(id);
    StorageService.setColorTheme(id);
    document.documentElement.dataset.colorTheme = id;
  };

  if (!isOpen) return null;

  const handleSaveFSRS = () => {
    StorageService.saveFSRSSettings(params);
    StorageService.setRolloverHour(rolloverHour);
    setStatusMsg({ type: 'success', text: 'Parâmetros FSRS atualizados com sucesso!' });
    setTimeout(() => setStatusMsg(null), 3000);
    onRefresh();
  };

  const handleResetFSRS = () => {
    setConfirmResetFSRS(true);
  };

  const executeResetFSRS = () => {
    setParams({ ...DEFAULT_FSRS_PARAMETERS });
    StorageService.saveFSRSSettings(DEFAULT_FSRS_PARAMETERS);
    setStatusMsg({ type: 'success', text: 'Parâmetros restaurados aos padrões oficiais.' });
    setConfirmResetFSRS(false);
    setTimeout(() => setStatusMsg(null), 3000);
    onRefresh();
  };

  const handleResetDefaultData = () => {
    setConfirmResetData(true);
  };

  const executeResetDefaultData = () => {
    StorageService.resetToDefault();
    setConfirmResetData(false);
    onRefresh();
    onClose();
  };

  const TABS: { id: 'fsrs'; label: string }[] = [
    { id: 'fsrs', label: 'Geral' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-xl bg-white dark:bg-ios-card-dark rounded-[20px] border border-black/[0.04] dark:border-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.2)] overflow-hidden flex flex-col max-h-[88vh] ios-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.05] dark:border-white/[0.07]">
          <div>
            <h3 className="text-[17px] font-bold text-zinc-900 dark:text-zinc-50">
              Configurações do Anki 2.0
            </h3>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Motor FSRS e Gerenciamento de Coleção
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher (iOS segmented control) */}
        <div className="px-6 pt-4">
          <div className="flex items-center rounded-[10px] bg-black/[0.06] dark:bg-white/[0.08] p-[2px]">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-[7px] rounded-[8px] text-xs font-semibold transition-all active:scale-[0.98] ${
                  activeTab === tab.id
                    ? 'bg-white dark:bg-[#636366] text-zinc-900 dark:text-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]'
                    : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Status message banner */}
        {statusMsg && (
          <div
            className={`mx-6 mt-3 p-3 rounded-[12px] text-xs flex items-center gap-2 ${
              statusMsg.type === 'success'
                ? 'bg-ios-green/10 text-emerald-700 dark:text-ios-green'
                : 'bg-ios-red/10 text-ios-red'
            }`}
          >
            {statusMsg.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span className="font-medium">{statusMsg.text}</span>
          </div>
        )}

        {/* Body content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {activeTab === 'fsrs' && (            <div className="space-y-5">
              {/* Day rollover — when the study day starts */}
              <div className="px-3.5 py-3 rounded-[16px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06]">
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-ios-blue shrink-0" />
                  <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">
                    Início do dia de estudo
                  </span>
                </div>
                <p className="text-[13px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  O dia de estudo começa{' '}
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={rolloverHour}
                    onChange={(e) =>
                      setRolloverHour(Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0)))
                    }
                    className="w-14 px-2 py-1 mx-0.5 rounded-[8px] bg-white dark:bg-zinc-900 border border-black/[0.08] dark:border-white/[0.12] text-center font-mono font-semibold tabular-nums text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-ios-blue"
                  />{' '}
                  horas após a meia-noite — ou seja, às{' '}
                  <span className="font-semibold text-ios-blue tabular-nums">
                    {String(rolloverHour).padStart(2, '0')}:00
                  </span>
                  .
                </p>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2 leading-relaxed">
                  Ex.: com 4, revisar às 2:30 ainda conta para o dia anterior (padrão do Anki).
                </p>
              </div>

              {/* Theme selector */}
              <div className="px-3.5 py-3 rounded-[16px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06]">
                <div className="flex items-center gap-2 mb-3">
                  <Monitor className="w-4 h-4 text-ios-blue shrink-0" />
                  <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">
                    Tema da interface
                  </span>
                </div>
                <div className="flex gap-2">
                  {(['light', 'dark', 'system'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleThemeChange(t)}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-[10px] text-[13px] font-medium transition-all active:scale-[0.98] ${
                        theme === t
                          ? 'bg-ios-blue text-white shadow-[0_2px_8px_rgba(0,122,255,0.35)]'
                          : 'bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200 border border-black/[0.06] dark:border-white/[0.1] hover:border-ios-blue/50'
                      }`}
                    >
                      {t === 'light' && <Sun className="w-4 h-4" />}
                      {t === 'dark' && <Moon className="w-4 h-4" />}
                      {t === 'system' && <Monitor className="w-4 h-4" />}
                      <span className="capitalize">{t}</span>
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2 leading-relaxed">
                  Sistema segue a preferência do Windows/Android.
                </p>
              </div>

              {/* Color theme palette selector (OpenCode themes) */}
              <div className="px-3.5 py-3 rounded-[16px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06]">
                <div className="flex items-center gap-2 mb-3">
                  <Palette className="w-4 h-4 text-ios-blue shrink-0" />
                  <span className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">
                    Paleta de cores
                  </span>
                </div>
                <IOSSelect
                  value={colorTheme}
                  onChange={handleColorThemeChange}
                  placeholder="Selecionar tema…"
                  maxMenuHeight={280}
                  className="w-full !text-[13px] !px-3 !py-2.5"
                  active={colorTheme !== DEFAULT_COLOR_THEME}
                  options={COLOR_THEME_NAMES.map((id) => {
                    const modes = COLOR_THEMES[id]?.modes ?? [];
                    const hints: string[] = [];
                    if (id === DEFAULT_COLOR_THEME) hints.push('padrão');
                    if (modes.length === 1) hints.push(modes[0] === 'dark' ? 'somente escuro' : 'somente claro');
                    return { value: id, label: id, hint: hints.join(' · ') || undefined };
                  })}
                />
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-2 leading-relaxed">
                  Temas de cores inspirados no OpenCode ({COLOR_THEME_NAMES.length} temas). Aplica sobre o tema claro/escuro acima. Temas "somente escuro" aplicam só no modo escuro.
                </p>
              </div>

              <div className="flex items-center justify-between pt-3">
                <button
                  type="button"
                  onClick={handleResetFSRS}
                  className="text-[13px] font-medium text-zinc-500 hover:text-ios-red dark:hover:text-ios-red transition-colors"
                >
                  Restaurar Padrão Oficial
                </button>

                <button
                  type="button"
                  onClick={handleSaveFSRS}
                  className="px-5 py-2 rounded-full bg-ios-blue hover:bg-[#0071eb] text-white font-semibold text-[13px] shadow-[0_2px_8px_rgba(0,122,255,0.35)] transition-all active:scale-95"
                >
                  Salvar Configurações
                </button>
              </div>

              <div className="pt-3 border-t border-black/[0.05] dark:border-white/[0.07]">
                <button
                  type="button"
                  onClick={handleResetDefaultData}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold text-ios-red hover:bg-ios-red/10 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Resetar Coleção (apaga todos os dados)</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmResetFSRS}
        onClose={() => setConfirmResetFSRS(false)}
        onConfirm={executeResetFSRS}
        title="Restaurar Parâmetros FSRS?"
        description="Esta ação redefinirá os 19 pesos matemáticos e a retenção desejada para as configurações oficiais padrão do FSRS v4.5."
        confirmText="Restaurar FSRS"
        cancelText="Cancelar"
        variant="warning"
      />

      <ConfirmationModal
        isOpen={confirmResetData}
        onClose={() => setConfirmResetData(false)}
        onConfirm={executeResetDefaultData}
        title="Resetar toda a coleção?"
        description="Esta ação apagará todos os seus decks, cards e histórico de revisões. A coleção ficará limpa, com apenas o deck Padrão e os tipos de nota Básico, Cloze e Shadowing."
        confirmText="Resetar Tudo"
        cancelText="Cancelar"
        variant="danger"
      />
    </div>
  );
};
