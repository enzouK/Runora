import React, { useState } from 'react';
import {
  X,
  Sliders,
  Download,
  Upload,
  RotateCcw,
  Puzzle,
  Sparkles,
  Check,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { FSRSParameters } from '../../types/anki';
import { StorageService } from '../../services/storage';
import { ExportImportService } from '../../services/exportImport';
import { DEFAULT_FSRS_PARAMETERS, DEFAULT_FSRS_WEIGHTS } from '../../fsrs/constants';
import { AddonSystem } from '../../services/addonSystem';
import { ConfirmationModal } from '../common/ConfirmationModal';

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
  const [activeTab, setActiveTab] = useState<'fsrs' | 'data' | 'addons'>('fsrs');
  const [params, setParams] = useState<FSRSParameters>(() => StorageService.getFSRSSettings());
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showWeightsEditor, setShowWeightsEditor] = useState(false);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Configurações do Anki 2.0
              </h3>
              <p className="text-xs text-zinc-400">Motor FSRS e Gerenciamento de Coleção</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switcher (iOS segmented pill) */}
        <div className="px-6 pt-4">
          <div className="flex p-1 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('fsrs')}
              className={`flex-1 py-1.5 rounded-xl transition-all ${
                activeTab === 'fsrs'
                  ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              Algoritmo FSRS
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('data')}
              className={`flex-1 py-1.5 rounded-xl transition-all ${
                activeTab === 'data'
                  ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              Importar / Exportar
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('addons')}
              className={`flex-1 py-1.5 rounded-xl transition-all ${
                activeTab === 'addons'
                  ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
              }`}
            >
              Addons JS
            </button>
          </div>
        </div>

        {/* Status message banner */}
        {statusMsg && (
          <div
            className={`mx-6 mt-3 p-3 rounded-2xl text-xs flex items-center gap-2 ${
              statusMsg.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
            }`}
          >
            {statusMsg.type === 'success' ? (
              <Check className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusMsg.text}</span>
          </div>
        )}

        {/* Body content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {activeTab === 'fsrs' && (
            <div className="space-y-5">
              <div className="p-4 rounded-2xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40 text-xs text-blue-900 dark:text-blue-200">
                <span className="font-bold flex items-center gap-1.5 mb-1 text-blue-700 dark:text-blue-300">
                  <Sparkles className="w-4 h-4 text-blue-500" />
                  Free Spaced Repetition Scheduler (FSRS)
                </span>
                O Anki 2.0 utiliza exclusivamente a arquitetura moderna FSRS em vez do antigo SM-2. O FSRS modela a estabilidade e dificuldade com retrievabilidade contínua baseada em retenção desejada.
              </div>

              {/* Retention slider */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                    Retenção Desejada (Request Retention)
                  </label>
                  <span className="text-sm font-mono font-bold text-blue-600 dark:text-blue-400">
                    {Math.round(params.requestRetention * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.70"
                  max="0.98"
                  step="0.01"
                  value={params.requestRetention}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, requestRetention: parseFloat(e.target.value) }))
                  }
                  className="w-full accent-blue-600 cursor-pointer"
                />
                <div className="flex justify-between text-[11px] text-zinc-400 mt-1">
                  <span>70% (Menor carga de estudo)</span>
                  <span>90% (Recomendado)</span>
                  <span>98% (Máxima precisão)</span>
                </div>
              </div>

              {/* Maximum interval */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300 mb-1.5">
                  Intervalo Máximo (Dias)
                </label>
                <input
                  type="number"
                  min="30"
                  max="36500"
                  value={params.maximumInterval}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, maximumInterval: parseInt(e.target.value, 10) || 36500 }))
                  }
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-sm font-mono text-zinc-900 dark:text-zinc-100"
                />
              </div>

              {/* Interval fuzz toggle (Anki) */}
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Variação de intervalo (Fuzz)
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                    Aleatoriza levemente as revisões (±25% até 7 dias; ±5% acima, sem efeito abaixo
                    de 2,5 dias) para evitar acúmulo no mesmo dia — igual ao Anki.
                  </p>
                </div>
                {/* iOS switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={params.enableFuzz}
                  onClick={() => setParams((p) => ({ ...p, enableFuzz: !p.enableFuzz }))}
                  className={`relative w-11 h-7 rounded-full transition-colors shrink-0 ${
                    params.enableFuzz ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-zinc-600'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform ${
                      params.enableFuzz ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Day rollover (virada do dia) — Anki default 4 AM */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-300 mb-1.5">
                  Virada do dia (Rollover)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min="0"
                    max="23"
                    value={rolloverHour}
                    onChange={(e) =>
                      setRolloverHour(
                        Math.min(23, Math.max(0, parseInt(e.target.value, 10) || 0))
                      )
                    }
                    className="w-20 px-3.5 py-2.5 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-sm font-mono text-zinc-900 dark:text-zinc-100 text-center"
                  />
                  <span className="text-sm text-zinc-600 dark:text-zinc-300">
                    horas (00–23)
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                  Define a que horas começa um "novo dia" para limites diários. Padrão do Anki:
                  <strong> 4h da manhã</strong>. Ex.: estudar às 2:30 com rollover 4 conta para o
                  dia anterior.
                </p>
              </div>

              {/* FSRS Weights Inspector */}
              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowWeightsEditor(!showWeightsEditor)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >
                  <span>{showWeightsEditor ? 'Ocultar' : 'Exibir'} os 19 Pesos w[0..18] do FSRS</span>
                </button>

                {showWeightsEditor && (
                  <div className="mt-3 p-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 text-[11px] font-mono grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                    {params.w.map((weight, idx) => (
                      <div key={idx} className="flex items-center justify-between p-1.5 rounded-lg bg-white dark:bg-zinc-900">
                        <span className="text-zinc-400">w[{idx}]:</span>
                        <span className="font-bold text-zinc-800 dark:text-zinc-200">{weight}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-3">
                <button
                  type="button"
                  onClick={handleResetFSRS}
                  className="text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 underline"
                >
                  Restaurar Padrão Oficial
                </button>

                <button
                  type="button"
                  onClick={handleSaveFSRS}
                  className="px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-md transition-all active:scale-95"
                >
                  Salvar Parâmetros FSRS
                </button>
              </div>
            </div>
          )}

          {activeTab === 'data' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                  Exportar Coleção (.colpkg)
                </h4>
                <p className="text-xs text-zinc-500">
                  Gera um pacote com todos os decks, subdecks, notas, cards com parâmetros FSRS e histórico de revisões.
                </p>
                <button
                  type="button"
                  onClick={handleExport}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-all active:scale-95"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Baixar Coleção (.colpkg / FSRS)</span>
                </button>
              </div>

              <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
                  Importar Coleção (.colpkg / .apkg / .json)
                </h4>
                <p className="text-xs text-zinc-500">
                  Carregue um pacote de cartas exportado. Os parâmetros FSRS serão automaticamente sincronizados.
                </p>
                <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 text-zinc-800 dark:text-zinc-100 text-xs font-semibold cursor-pointer transition-all active:scale-95">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Selecionar Arquivo .colpkg / .json</span>
                  <input
                    type="file"
                    accept=".colpkg,.apkg,.json"
                    className="hidden"
                    onChange={handleImportFile}
                  />
                </label>
              </div>

              <div className="pt-3 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={handleResetDefaultData}
                  className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 font-semibold"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Resetar Coleção (apaga todos os dados)</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'addons' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-900 dark:text-purple-200">
                <span className="font-bold flex items-center gap-1.5 mb-1">
                  <Puzzle className="w-4 h-4 text-purple-500" />
                  Sistema de Addons em JavaScript
                </span>
                Arquitetura preparada para plugins em JS multiplataforma (Windows 11 e Android). O sistema expõe ganchos como <code>beforeCardRender</code> e <code>afterReviewSubmit</code>.
              </div>

              <div className="space-y-2">
                {addons.map((addon) => (
                  <div
                    key={addon.id}
                    className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-700 flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                          {addon.name}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                          v{addon.version}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-0.5">{addon.description}</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggleAddon(addon.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                        addon.enabled
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300'
                      }`}
                    >
                      {addon.enabled ? 'Ativo' : 'Desativado'}
                    </button>
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
