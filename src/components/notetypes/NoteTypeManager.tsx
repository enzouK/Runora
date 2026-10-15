import React, { useState } from 'react';
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
  ChevronRight,
  Code2,
} from 'lucide-react';
import { FieldDefinition, NoteType } from '../../types/anki';
import { StorageService } from '../../services/storage';
import { CardTemplateEditorModal } from './CardTemplateEditorModal';
import { ConfirmationModal } from '../common/ConfirmationModal';

export const NoteTypeManager: React.FC<{ onRefresh: () => void }> = ({ onRefresh }) => {
  const [noteTypes, setNoteTypes] = useState<NoteType[]>(() => StorageService.getNoteTypes());
  const [editingType, setEditingType] = useState<NoteType | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [templateEditingNoteType, setTemplateEditingNoteType] = useState<NoteType | null>(null);
  const [noteTypeToDelete, setNoteTypeToDelete] = useState<NoteType | null>(null);
  const [showMinNoteTypeWarning, setShowMinNoteTypeWarning] = useState(false);

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
              ? '<div class="anki-cloze-prompt">{{cloze:Texto}}</div>'
              : `<div class="anki-front-content">{{${cleanedFields[0]?.name || 'Frente'}}}</div>${
                  hintsEnabled ? '\n{{hint}}' : ''
                }`,
            afmt: isCloze
              ? '<div class="anki-cloze-prompt">{{cloze:Texto}}</div><hr/><div class="anki-extra">{{Extra}}</div>'
              : `{{FrontSide}}<hr/><div class="anki-back-content">{{${cleanedFields[1]?.name || 'Verso'}}}</div>`,
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Tipos de Nota (Note Types)
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Configure modelos de cards, campos ricos e ative recursos como Dicas e Gravação de Voz por tipo.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-all active:scale-95"
        >
          <Plus className="w-4 h-4" />
          <span>Criar Tipo de Nota</span>
        </button>
      </div>

      {/* Note Type Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {noteTypes.map((nt) => (
          <div
            key={nt.id}
            className="p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800/90 shadow-sm flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                      {nt.name}
                    </h3>
                    <span className="text-[11px] text-zinc-400">
                      {nt.fields.length} campos • {nt.templates.length} templates
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEditModal(nt)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                    title="Editar"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteClick(nt)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    title="Excluir"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Feature Tags */}
              <div className="flex flex-wrap gap-1.5 my-3">
                {nt.isCloze && (
                  <span className="px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[11px] font-medium border border-purple-500/20">
                    Cloze Deletion
                  </span>
                )}
                {nt.hintsEnabled && (
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[11px] font-medium border border-amber-500/20">
                    <Lightbulb className="w-3 h-3" />
                    Show Hint Ativo
                  </span>
                )}
                {nt.voiceRecordingEnabled && (
                  <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[11px] font-medium border border-rose-500/20">
                    <Volume2 className="w-3 h-3" />
                    Voice Recording Ativo
                  </span>
                )}
              </div>

              {/* Fields list */}
              <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800 text-xs">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block mb-1">
                  Campos:
                </span>
                <div className="flex flex-wrap gap-1">
                  {nt.fields.map((f) => (
                    <span
                      key={f.id}
                      className="px-2 py-0.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-[11px]"
                    >
                      {f.name}
                    </span>
                  ))}
                </div>
              </div>

              {/* Edit HTML Templates Action Button */}
              <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setTemplateEditingNoteType(nt)}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3.5 rounded-xl bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 font-semibold text-xs transition-all border border-blue-200/60 dark:border-blue-800/60 active:scale-[0.99]"
                >
                  <Code2 className="w-4 h-4" />
                  <span>Editar Templates HTML (Frente e Verso)</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Note Type Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                {editingType ? 'Editar Tipo de Nota' : 'Novo Tipo de Nota'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                  Nome do Tipo de Nota
                </label>
                <input
                  type="text"
                  value={typeName}
                  onChange={(e) => setTypeName(e.target.value)}
                  placeholder="ex: Vocabulário Alemão"
                  className="w-full px-3.5 py-2.5 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Special Note Type Feature Switches */}
              <div className="p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-700/60 space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Recursos do Note Type (Anki 2.0)
                </div>

                {/* Cloze Toggle */}
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Scissors className="w-4 h-4 text-purple-500" />
                    <div>
                      <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                        Suporte a Omissão (Cloze)
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        Processa tags do tipo {'{{c1::palavra}}'}
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={isCloze}
                    onChange={(e) => setIsCloze(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                  />
                </label>

                {/* Hints Toggle */}
                <label className="flex items-center justify-between cursor-pointer pt-2 border-t border-zinc-200/60 dark:border-zinc-700/60">
                  <div className="flex items-center gap-2">
                    <Lightbulb className="w-4 h-4 text-amber-500" />
                    <div>
                      <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                        Habilitar Dicas (Show Hint)
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        Cria automaticamente o campo Hint e ativa a tag {'{{hint}}'} no HTML (frente ou verso)
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={hintsEnabled}
                    onChange={(e) => handleToggleHints(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                  />
                </label>

                {/* Voice Recording Toggle */}
                <label className="flex items-center justify-between cursor-pointer pt-2 border-t border-zinc-200/60 dark:border-zinc-700/60">
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-rose-500" />
                    <div>
                      <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                        Habilitar Voice Recording
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        Ativa gravação e reprodução exclusiva da sua voz via tags {'{{voice:record}}'} e {'{{voice:reproduce}}'} no HTML
                      </div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={voiceRecordingEnabled}
                    onChange={(e) => setVoiceRecordingEnabled(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                  />
                </label>
              </div>

              {/* Fields List */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Campos (Fields)
                  </label>
                  <button
                    type="button"
                    onClick={handleAddField}
                    className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700"
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
                        className={`flex items-center gap-2 p-2 rounded-2xl border transition-all ${
                          isHintField
                            ? 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-200/80 dark:border-amber-800/60'
                            : 'bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700'
                        }`}
                      >
                        <span className="text-xs font-mono font-bold text-zinc-400 w-5 text-center">
                          {idx + 1}
                        </span>

                        {isHintField ? (
                          <div className="flex-1 flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-white/90 dark:bg-zinc-900/90 border border-amber-300/60 dark:border-amber-700/60 text-xs font-medium text-amber-900 dark:text-amber-200 shadow-xs">
                            <div className="flex items-center gap-1.5">
                              <span>💡</span>
                              <span className="font-semibold">Hint</span>
                              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-normal">
                                (Dica automática do sistema)
                              </span>
                            </div>
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300">
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
                            className="flex-1 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 disabled:opacity-30 transition-colors"
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

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 rounded-full text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!typeName.trim()}
                className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs shadow-md transition-all active:scale-95 disabled:opacity-50"
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
