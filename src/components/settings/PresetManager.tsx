import React, { useState } from 'react';
import { Layers, Plus, Trash2, Users } from 'lucide-react';
import { Preset } from '../../types/anki';
import { StorageService } from '../../services/storage';
import { ConfirmationModal } from '../common/ConfirmationModal';

interface PresetManagerProps {
  onRefresh?: () => void;
}

/**
 * Anki-style preset management: create, rename and delete option presets.
 * Each preset is an option sheet shared by every deck linked to it; editing
 * its values happens via "Editar Deck" (this tab only handles the list).
 */
export const PresetManager: React.FC<PresetManagerProps> = ({ onRefresh }) => {
  const [presets, setPresets] = useState<Preset[]>(() => StorageService.getPresets());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<Preset | null>(null);

  /** Decks linked to each preset; unlinked decks fall back to the factory preset. */
  const usageCounts = (presetId: string): number => {
    const decks = StorageService.getDecks();
    return decks.filter((d) =>
      presetId === StorageService.DEFAULT_PRESET_ID
        ? !d.presetId || d.presetId === presetId
        : d.presetId === presetId
    ).length;
  };

  const reload = () => {
    setPresets(StorageService.getPresets());
    onRefresh?.();
  };

  /** Commit a rename draft (blur or Enter). Empty drafts restore the stored name. */
  const commitRename = (preset: Preset) => {
    const draft = drafts[preset.id];
    if (draft === undefined) return;
    const trimmed = draft.trim();
    const stored = presets.find((p) => p.id === preset.id);
    if (trimmed && stored && trimmed !== stored.name) {
      StorageService.upsertPreset({ ...stored, name: trimmed });
      reload();
    }
    setDrafts((d) => {
      const next = { ...d };
      delete next[preset.id];
      return next;
    });
  };

  const handleCreate = () => {
    StorageService.createPreset(newName);
    setNewName('');
    reload();
  };

  const handleDeleteConfirm = () => {
    if (!deleting) return;
    StorageService.deletePreset(deleting.id);
    setDeleting(null);
    reload();
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-[16px] bg-ios-blue/10">
        <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
          Cada preset é uma folha de opções compartilhada: todos os decks ligados a ele usam as
          mesmas configurações. Os valores de cada preset são editados no <strong>Editar Deck</strong>{' '}
          de qualquer deck ligado a ele. O preset <strong>Padrão</strong> de fábrica é permanente.
        </p>
      </div>

      {/* Create new preset */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && newName.trim() && handleCreate()}
          placeholder="Nome do novo preset…"
          className="flex-1 px-3.5 py-2.5 rounded-[12px] bg-black/[0.05] dark:bg-white/[0.09] border border-transparent focus:border-ios-blue focus:outline-none text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
        />
        <button
          type="button"
          onClick={handleCreate}
          disabled={!newName.trim()}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-[12px] bg-ios-blue hover:bg-[#0071eb] text-white text-[13px] font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100"
        >
          <Plus className="w-4 h-4" />
          Criar
        </button>
      </div>

      {/* Preset list */}
      <div className="rounded-[16px] border border-black/[0.06] dark:border-white/[0.08] divide-y divide-black/[0.05] dark:divide-white/[0.06] overflow-hidden">
        {presets.map((preset) => {
          const isFactory = preset.id === StorageService.DEFAULT_PRESET_ID;
          const count = usageCounts(preset.id);
          return (
            <div
              key={preset.id}
              className="flex items-center gap-3 px-4 py-3 bg-white dark:bg-transparent"
            >
              <Layers className="w-4 h-4 text-ios-blue shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={drafts[preset.id] ?? preset.name}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [preset.id]: e.target.value }))
                    }
                    onBlur={() => commitRename(preset)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    title={isFactory ? 'Preset de fábrica (renomeável, não deletável)' : 'Renomear preset'}
                    className="w-full min-w-0 px-2 py-1 rounded-[8px] bg-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.06] focus:bg-black/[0.05] dark:focus:bg-white/[0.09] border border-transparent focus:border-ios-blue focus:outline-none text-sm font-semibold text-zinc-900 dark:text-zinc-100"
                  />
                  {isFactory && (
                    <span className="shrink-0 px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-white/[0.08] text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      de fábrica
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-0.5 pl-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                  <Users className="w-3 h-3" />
                  <span>
                    {count === 1 ? '1 deck usa este preset' : `${count} decks usam este preset`}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDeleting(preset)}
                disabled={isFactory}
                title={
                  isFactory
                    ? 'O preset de fábrica não pode ser excluído'
                    : 'Excluir preset (decks ligados passam ao Padrão)'
                }
                className="p-2 rounded-[10px] text-zinc-400 hover:text-red-600 hover:bg-red-500/10 dark:hover:text-red-400 transition-colors disabled:opacity-30 disabled:hover:text-zinc-400 disabled:hover:bg-transparent"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      <ConfirmationModal
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={handleDeleteConfirm}
        title="Excluir preset?"
        description={`Os decks que usam "${deleting?.name}" passarão a usar o preset de fábrica "Padrão". As opções dos decks mudam junto.`}
        highlightItem={deleting?.name}
        confirmText="Excluir preset"
        variant="danger"
      />
    </div>
  );
};
