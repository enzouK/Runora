import React, { useState } from 'react';
import {
  X,
  Clock,
  Download,
  Upload,
  RotateCcw,
  Puzzle,
  Check,
  AlertCircle,
} from 'lucide-react';
import { FSRSParameters } from '../../types/anki';
import { StorageService } from '../../services/storage';
import { ExportImportService } from '../../services/exportImport';
import { DEFAULT_FSRS_PARAMETERS } from '../../fsrs/constants';
import { AddonSystem } from '../../services/addonSystem';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { IOSSwitch } from '../common/IOSSwitch';
import { PresetManager } from './PresetManager';

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
  const [activeTab, setActiveTab] = useState<'fsrs' | 'presets' | 'data' | 'addons'>('fsrs');
  const [params, setParams] = useState<FSRSParameters>(() => StorageService.getFSRSSettings());
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [addons, setAddons] = useState(() => AddonSystem.getAddons());
  const [confirmResetFSRS, setConfirmResetFSRS] = useState(false);
  const [confirmResetData, setConfirmResetData] = useState(false);
  const [rolloverHour, setRolloverHour] = useState<number>(() => StorageService.getRolloverHour());

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

  const handleExport = async () => {
    await ExportImportService.exportCollectionPackage();
    setStatusMsg({ type: 'success', text: 'Coleção exportada (.colpkg) com sucesso!' });
    setTimeout(() => setStatusMsg(null), 3500);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const res = await ExportImportService.importPackage(file);
    if (res.success) {
      setStatusMsg({ type: 'success', text: res.message });
      onRefresh();
    } else {
      setStatusMsg({ type: 'error', text: res.message });
    }
    setTimeout(() => setStatusMsg(null), 4000);
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

  const handleToggleAddon = (id: string) => {
    AddonSystem.toggleAddon(id);
    setAddons(AddonSystem.getAddons());
  };

  const TABS: { id: 'fsrs' | 'presets' | 'data' | 'addons'; label: string }[] = [
    { id: 'fsrs', label: 'Geral' },
    { id: 'presets', label: 'Presets' },
    { id: 'data', label: 'Importar / Exportar' },
    { id: 'addons', label: 'Addons JS' },
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
          {activeTab === 'fsrs' && (
            <div className="space-y-5">
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
            </div>
          )}

          {activeTab === 'presets' && (
            <PresetManager onRefresh={onRefresh} />
          )}

          {activeTab === 'data' && (
            <div className="space-y-4">
              <div className="p-4 rounded-[16px] bg-ios-blue/10 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-ios-blue">
                  Exportar Coleção (.colpkg)
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Gera um pacote com todos os decks, subdecks, notas, cards com parâmetros FSRS e histórico de revisões.
                </p>
                <button
                  type="button"
                  onClick={handleExport}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-ios-blue hover:bg-[#0071eb] text-white text-[13px] font-semibold shadow-[0_2px_8px_rgba(0,122,255,0.35)] transition-all active:scale-95"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar Coleção (.colpkg / FSRS)</span>
                </button>
              </div>

              <div className="p-4 rounded-[16px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                  Importar Coleção (.colpkg / .apkg / .json)
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Carregue um pacote de cartas exportado. Os parâmetros FSRS serão automaticamente sincronizados.
                </p>
                <label className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/[0.06] dark:bg-white/[0.1] hover:bg-black/[0.1] dark:hover:bg-white/[0.15] text-zinc-800 dark:text-zinc-100 text-[13px] font-semibold cursor-pointer transition-all active:scale-95">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Selecionar Arquivo</span>
                  <input
                    type="file"
                    accept=".colpkg,.apkg,.json"
                    className="hidden"
                    onChange={handleImportFile}
                  />
                </label>
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

          {activeTab === 'addons' && (
            <div className="space-y-4">
              <div className="p-4 rounded-[16px] bg-purple-500/10 text-[13px] text-purple-900 dark:text-purple-200">
                <span className="font-bold flex items-center gap-1.5 mb-1 text-purple-600 dark:text-purple-300">
                  <Puzzle className="w-4 h-4" />
                  Sistema de Addons em JavaScript
                </span>
                Arquitetura preparada para plugins em JS multiplataforma (Windows 11 e Android). O sistema expõe ganchos como <code>beforeCardRender</code> e <code>afterReviewSubmit</code>.
              </div>

              <div className="space-y-2">
                {addons.map((addon) => (
                  <div
                    key={addon.id}
                    className="p-3.5 rounded-[16px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-bold text-zinc-900 dark:text-zinc-100">
                          {addon.name}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/[0.05] dark:bg-white/[0.1] text-zinc-500 dark:text-zinc-400">
                          v{addon.version}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">{addon.description}</p>
                    </div>

                    <IOSSwitch
                      checked={addon.enabled}
                      onChange={() => handleToggleAddon(addon.id)}
                    />
                  </div>
                ))}
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
