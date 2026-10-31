import React, { useState, useMemo } from 'react';
import {
  Layers,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Volume2,
  Lightbulb,
  Scissors,
  Code2,
} from 'lucide-react';
import { FieldDefinition, NoteType } from '../../types/runora';
import { StorageService } from '../../services/storage';
import { CardTemplateEditorModal } from './CardTemplateEditorModal';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { IOSSwitch } from '../common/IOSSwitch';

export const NoteTypeManager: React.FC<{ onRefresh: () => void }> = ({ onRefresh }) => {
  const [noteTypes, setNoteTypes] = useState<NoteType[]>(() => StorageService.getNoteTypes());
  const [editingType, setEditingType] = useState<NoteType | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [templateEditingNoteType, setTemplateEditingNoteType] = useState<NoteType | null>(null);
  const [noteTypeToDelete, setNoteTypeToDelete] = useState<NoteType | null>(null);
  const [showMinNoteTypeWarning, setShowMinNoteTypeWarning] = useState(false);

  const notes = useMemo(() => StorageService.getNotes(), [onRefresh]);

  // How many notes use each note type (helps decide what is safe to delete)
  const usageByType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const n of notes) {
      map[n.noteTypeId] = (map[n.noteTypeId] || 0) + 1;
    }
    return map;
  }, [notes]);

  // New Note Type form state
  const [typeName, setTypeName] = useState('');
  const [isCloze, setIsCloze] = useState(false);
  const [hintsEnabled, setHintsEnabled] = useState(false);
  const [voiceRecordingEnabled, setVoiceRecordingEnabled] = useState(false);
  const [fields, setFields] = useState<FieldDefinition[]>([
    { id: 'f-1', name: 'Frente', ord: 0, description: '' },
    { id: 'f-2', name: 'Verso', ord: 1, description: '' },
  ]);

  const openCreateModal = () => {
    setEditingType(null);
    setTypeName('');
    setIsCloze(false);
    setHintsEnabled(false);
    setVoiceRecordingEnabled(false);
    setFields([
      { id: 'f-1', name: 'Frente', ord: 0 },
      { id: 'f-2', name: 'Verso', ord: 1 },
    ]);
    setIsModalOpen(true);
  };

  const openEditModal = (nt: NoteType) => {
    setEditingType(nt);
    setTypeName(nt.name);
    setIsCloze(nt.isCloze);
    setHintsEnabled(nt.hintsEnabled);
    setVoiceRecordingEnabled(nt.voiceRecordingEnabled);

    // If hintsEnabled is true, ensure Hint field exists
    let initialFields = [...nt.fields];
    if (nt.hintsEnabled && !initialFields.some((f) => f.name.toLowerCase() === 'hint')) {
      initialFields.push({
        id: `f-hint-auto-${Date.now()}`,
        name: 'Hint',
        ord: initialFields.length,
        description: 'Dica do cartão',
      });
    }
    setFields(initialFields);
    setIsModalOpen(true);
  };

  const handleToggleHints = (enabled: boolean) => {
    setHintsEnabled(enabled);
    if (enabled) {
      // Add Hint field if not already present
      if (!fields.some((f) => f.name.toLowerCase() === 'hint')) {
        setFields((prev) => [
          ...prev,
          {
            id: `f-hint-auto-${Date.now()}`,
            name: 'Hint',
            ord: prev.length,
            description: 'Dica do cartão',
          },
        ]);
      }
    } else {
      // Remove Hint field
      setFields((prev) => prev.filter((f) => f.name.toLowerCase() !== 'hint'));
    }
  };

  const handleAddField = () => {
    const nextOrd = fields.length;
    setFields((prev) => [
      ...prev,
      {
        id: `f-${Date.now()}`,
        name: `Campo ${nextOrd + 1}`,
        ord: nextOrd,
      },
    ]);
  };

  const handleRemoveField = (id: string) => {
    if (fields.length <= 1) return;
    setFields((prev) => prev.filter((f) => f.id !== id));
  };

  const handleSave = () => {
    if (!typeName.trim()) return;

    const allTypes = StorageService.getNoteTypes();

    const cleanedFields = fields.map((f, idx) => ({ ...f, ord: idx }));

    if (editingType) {
      const updated = allTypes.map((nt) =>
        nt.id === editingType.id
          ? {
              ...nt,
              name: typeName.trim(),
              isCloze,
              hintsEnabled,
              voiceRecordingEnabled,
              fields: cleanedFields,
              updatedAt: Date.now(),
            }
          : nt
      );
      StorageService.saveNoteTypes(updated);
      setNoteTypes(updated);
    } else {
      const newType: NoteType = {
        id: `nt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: typeName.trim(),
        isCloze,
        hintsEnabled,
        voiceRecordingEnabled,
        fields: cleanedFields,
        templates: [
          {
            id: `tmpl-${Date.now()}`,
            name: 'Padrão',
            ord: 0,
            qfmt: isCloze
              ? '<div class="runora-cloze-prompt">{{cloze:Texto}}</div>'
              : `<div class="runora-front-content">{{${cleanedFields[0]?.name || 'Frente'}}}</div>${
                  hintsEnabled ? '\n{{hint}}' : ''
                }`,
            afmt: isCloze
              ? '<div class="runora-cloze-prompt">{{cloze:Texto}}</div><hr/><div class="runora-extra">{{Extra}}</div>'
              : `{{FrontSide}}<hr/><div class="runora-back-content">{{${cleanedFields[1]?.name || 'Verso'}}}</div>`,
          },
        ],
        css: '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const updated = [...allTypes, newType];
      StorageService.saveNoteTypes(updated);
      setNoteTypes(updated);
    }

    setIsModalOpen(false);
    onRefresh();
  };

  const handleDeleteClick = (nt: NoteType) => {
    if (noteTypes.length <= 1) {
      setShowMinNoteTypeWarning(true);
      return;
    }
    setNoteTypeToDelete(nt);
  };

  const handleConfirmDelete = () => {
    if (noteTypeToDelete) {
      const updated = noteTypes.filter((nt) => nt.id !== noteTypeToDelete.id);
      StorageService.saveNoteTypes(updated);
      setNoteTypes(updated);
      setNoteTypeToDelete(null);
      onRefresh();
    }
  };

  return (
    <div className="space-y-6 ios-fade-in">
      {/* Large Title header */}
      <div className="flex items-end justify-between gap-4 px-1 pt-1">
        <div>
          <h2 className="text-[32px] leading-none font-bold tracking-tight text-zinc-900 dark:text-white">
            Note Types
          </h2>
          <p className="text-[15px] text-zinc-500 dark:text-zinc-400 mt-1.5">
            Modelos de cards, campos e recursos por tipo.
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          title="Novo Tipo de Nota"
          className="w-9 h-9 rounded-full flex items-center justify-center bg-ios-blue text-white shadow-[0_2px_8px_rgba(0,122,255,0.4)] hover:bg-[#0071eb] transition-all active:scale-90"
        >
          <Plus className="w-[18px] h-[18px]" strokeWidth={2.5} />
        </button>
      </div>

      {/* Note Type Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {noteTypes.map((nt) => (
          <div
            key={nt.id}
            className="p-5 rounded-[20px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)] flex flex-col"
          >
            <div>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Layers
                    className="w-5 h-5 text-purple-500 shrink-0"
                    fill="currentColor"
                    strokeWidth={0}
                  />
                  <div className="min-w-0">
                    <h3 className="font-semibold text-[15px] text-zinc-900 dark:text-zinc-50 truncate">
                      {nt.name}
                    </h3>
                    <span className="text-[12px] text-zinc-400 dark:text-zinc-500">
                      {nt.fields.length} campos • {nt.templates.length} template
                      {nt.templates.length > 1 ? 's' : ''} • {usageByType[nt.id] || 0} nota
                      {(usageByType[nt.id] || 0) === 1 ? '' : 's'} em uso
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEditModal(nt)}
                    className="p-1.5 rounded-full text-zinc-400 hover:text-ios-blue hover:bg-ios-blue/10 transition-colors"
                    title="Editar"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteClick(nt)}
                    className="p-1.5 rounded-full text-zinc-400 hover:text-ios-red hover:bg-ios-red/10 transition-colors"
                    title="Excluir"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Feature Tags */}
              <div className="flex flex-wrap gap-1.5 my-3">
                {nt.isCloze && (
                  <span className="px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[11px] font-semibold">
                    Cloze
                  </span>
                )}
                {nt.hintsEnabled && (
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-ios-orange/10 text-ios-orange text-[11px] font-semibold">
                    <Lightbulb className="w-3 h-3" />
                    Dicas (Hint)
                  </span>
                )}
                {nt.voiceRecordingEnabled && (
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-ios-red/10 text-ios-red text-[11px] font-semibold">
                    <Volume2 className="w-3 h-3" />
                    Gravação de Voz
                  </span>
                )}
              </div>
            </div>

            {/* Fields list (vertically centered in the card's leftover space) */}
            <div className="my-auto pt-3 pb-3 border-t border-black/[0.05] dark:border-white/[0.07]">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 block mb-1.5">
                  Campos
                </span>
                <div className="flex flex-wrap gap-1">
                  {nt.fields.map((f) => (
                    <span
                      key={f.id}
                      className="px-2 py-0.5 rounded-md bg-black/[0.04] dark:bg-white/[0.08] text-zinc-600 dark:text-zinc-300 text-[11px] font-medium"
                    >
                      {f.name}
                    </span>
                  ))}
                </div>
              </div>

            {/* Edit HTML Templates Action Button */}
            <div className="pt-3 border-t border-black/[0.05] dark:border-white/[0.07]">
              <button
                type="button"
                onClick={() => setTemplateEditingNoteType(nt)}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-3.5 rounded-[12px] bg-ios-blue/10 hover:bg-ios-blue/[0.16] text-ios-blue font-semibold text-[13px] transition-all active:scale-[0.99]"
              >
                <Code2 className="w-4 h-4" />
                <span>Editar Templates HTML</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Note Type Modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          // close on backdrop press (mousedown, so text-selection drags don't close)
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsModalOpen(false);
          }}
        >
          <div className="w-full max-w-lg bg-white dark:bg-ios-card-dark rounded-[20px] border border-black/[0.04] dark:border-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.2)] overflow-hidden flex flex-col max-h-[90vh] ios-fade-in">
            <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.05] dark:border-white/[0.07]">
              <h3 className="text-[17px] font-bold text-zinc-900 dark:text-zinc-50">
                {editingType ? 'Editar Tipo de Nota' : 'Novo Tipo de Nota'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1.5">
                  Nome do Tipo de Nota
                </label>
                <input
                  type="text"
                  value={typeName}
                  onChange={(e) => setTypeName(e.target.value)}
                  placeholder="ex: Vocabulário Alemão"
                  className="w-full px-3.5 py-2.5 rounded-[12px] bg-black/[0.05] dark:bg-white/[0.09] border border-transparent focus:border-ios-blue focus:outline-none text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
                />
              </div>

              {/* Special Note Type Feature Switches */}
              <div className="p-4 rounded-[16px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] space-y-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 pb-2">
                  Recursos do Note Type
                </div>

                {/* Cloze Toggle */}
                <label className="flex items-center justify-between gap-3 cursor-pointer py-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Scissors className="w-4 h-4 text-purple-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">
                        Omissão de Palavras (Cloze)
                      </div>
                      <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                        Processa marcações {'{{c1::palavra}}'}
                      </div>
                    </div>
                  </div>
                  <IOSSwitch checked={isCloze} onChange={setIsCloze} />
                </label>

                {/* Hints Toggle */}
                <label className="flex items-center justify-between gap-3 cursor-pointer py-2 border-t border-black/[0.05] dark:border-white/[0.07]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Lightbulb className="w-4 h-4 text-ios-orange shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">
                        Dicas (Show Hint)
                      </div>
                      <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                        Cria o campo Hint e ativa {'{{hint}}'} no HTML
                      </div>
                    </div>
                  </div>
                  <IOSSwitch checked={hintsEnabled} onChange={handleToggleHints} />
                </label>

                {/* Voice Recording Toggle */}
                <label className="flex items-center justify-between gap-3 cursor-pointer py-2 border-t border-black/[0.05] dark:border-white/[0.07]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Volume2 className="w-4 h-4 text-ios-red shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">
                        Gravação de Voz
                      </div>
                      <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                        Ativa {'{{voice:record}}'} e {'{{voice:reproduce}}'} no HTML
                      </div>
                    </div>
                  </div>
                  <IOSSwitch checked={voiceRecordingEnabled} onChange={setVoiceRecordingEnabled} />
                </label>
              </div>

              {/* Fields List */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    Campos (Fields)
                  </label>
                  <button
                    type="button"
                    onClick={handleAddField}
                    className="flex items-center gap-1 text-[13px] font-semibold text-ios-blue hover:text-[#0071eb] transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Adicionar Campo
                  </button>
                </div>

                <div className="space-y-2">
                  {fields.map((f, idx) => {
                    const isHintField = hintsEnabled && f.name.toLowerCase() === 'hint';
                    return (
                      <div
                        key={f.id}
                        className={`flex items-center gap-2 p-2 rounded-[12px] border transition-all ${
                          isHintField
                            ? 'bg-ios-orange/10 border-ios-orange/25'
                            : 'bg-black/[0.04] dark:bg-white/[0.07] border-transparent'
                        }`}
                      >
                        <span className="text-xs font-mono font-bold text-zinc-400 w-5 text-center shrink-0">
                          {idx + 1}
                        </span>

                        {isHintField ? (
                          <div className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-[10px] bg-white/90 dark:bg-zinc-900/90 border border-ios-orange/40 text-xs font-medium text-ios-orange">
                            <div className="flex items-center gap-1.5">
                              <span>💡</span>
                              <span className="font-semibold">Hint</span>
                              <span className="text-[10px] font-normal opacity-70">
                                (Dica automática do sistema)
                              </span>
                            </div>
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-ios-orange/15 text-ios-orange">
                              Fixo
                            </span>
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={f.name}
                            onChange={(e) => {
                              const newName = e.target.value;
                              setFields((prev) =>
                                prev.map((item) => (item.id === f.id ? { ...item, name: newName } : item))
                              );
                            }}
                            className="flex-1 px-2.5 py-1.5 rounded-[10px] bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-xs font-medium text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-ios-blue"
                          />
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            if (isHintField) {
                              handleToggleHints(false);
                            } else {
                              handleRemoveField(f.id);
                            }
                          }}
                          disabled={!isHintField && fields.length <= 1}
                          className="p-1.5 rounded-full text-zinc-400 hover:text-ios-red hover:bg-ios-red/10 disabled:opacity-30 transition-colors"
                          title={isHintField ? 'Remover campo Hint e desativar Show Hint' : 'Excluir campo'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-black/[0.05] dark:border-white/[0.07]">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 rounded-full text-[13px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!typeName.trim()}
                className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-ios-blue hover:bg-[#0071eb] text-white font-semibold text-[13px] shadow-[0_2px_8px_rgba(0,122,255,0.35)] transition-all active:scale-95 disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Salvar Note Type</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Card Template HTML / CSS Editor Modal */}
      {templateEditingNoteType && (
        <CardTemplateEditorModal
          isOpen={true}
          noteType={templateEditingNoteType}
          onClose={() => setTemplateEditingNoteType(null)}
          onSaved={() => {
            setNoteTypes(StorageService.getNoteTypes());
            onRefresh();
          }}
        />
      )}

      {/* Confirmation Modal for Deleting Note Type */}
      <ConfirmationModal
        isOpen={!!noteTypeToDelete}
        onClose={() => setNoteTypeToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Excluir Tipo de Nota?"
        description="Esta ação removerá este modelo de nota do sistema. Notas e cards já criados com este tipo de nota podem não ser exibidos ou renderizados adequadamente se o modelo for excluído."
        highlightItem={noteTypeToDelete ? noteTypeToDelete.name : undefined}
        confirmText="Excluir Modelo"
        cancelText="Cancelar"
        variant="danger"
      />

      {/* Notice Modal if user tries to delete the only remaining Note Type */}
      <ConfirmationModal
        isOpen={showMinNoteTypeWarning}
        onClose={() => setShowMinNoteTypeWarning(false)}
        onConfirm={() => setShowMinNoteTypeWarning(false)}
        title="Operação não permitida"
        description="O sistema precisa de pelo menos 1 Tipo de Nota ativo para que seja possível criar e organizar cards. Crie outro Tipo de Nota antes de tentar excluir este."
        confirmText="Entendido"
        showCancelButton={false}
        variant="warning"
      />
    </div>
  );
};
