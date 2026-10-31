import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  HelpCircle,
  Check,
} from 'lucide-react';
import { Deck, Note, NoteType } from '../../types/anki';
import { StorageService } from '../../services/storage';
import { AddonSystem } from '../../services/addonSystem';
import { AudioService } from '../../services/audioService';
import { RichMediaFieldEditor } from './RichMediaFieldEditor';
import { IOSSelect } from '../common/IOSSelect';

interface CardEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  initialDeckId?: string;
  editNoteId?: string | null;
}

export const CardEditorModal: React.FC<CardEditorModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  initialDeckId,
  editNoteId,
}) => {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [noteTypes, setNoteTypes] = useState<NoteType[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string>('');
  const [selectedNoteTypeId, setSelectedNoteTypeId] = useState<string>('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [tagsInput, setTagsInput] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    const loadedDecks = StorageService.getDecks();
    const loadedNoteTypes = StorageService.getNoteTypes();
    setDecks(loadedDecks);
    setNoteTypes(loadedNoteTypes);

    if (editNoteId) {
      const allNotes = StorageService.getNotes();
      const existing = allNotes.find((n) => n.id === editNoteId);
      if (existing) {
        setSelectedDeckId(existing.deckId);
        setSelectedNoteTypeId(existing.noteTypeId);
        setFields({ ...existing.fields });
        setTagsInput(existing.tags.join(' '));
        return;
      }
    }

    if (initialDeckId && loadedDecks.some((d) => d.id === initialDeckId)) {
      setSelectedDeckId(initialDeckId);
    } else if (loadedDecks.length > 0) {
      setSelectedDeckId(loadedDecks[0].id);
    }

    if (loadedNoteTypes.length > 0) {
      setSelectedNoteTypeId(loadedNoteTypes[0].id);
      // Initialize field keys
      const initialFields: Record<string, string> = {};
      loadedNoteTypes[0].fields.forEach((f) => {
        initialFields[f.name] = '';
      });
      setFields(initialFields);
    }
  }, [isOpen, initialDeckId, editNoteId]);

  const activeNoteType = noteTypes.find((nt) => nt.id === selectedNoteTypeId);

  const handleNoteTypeChange = (newTypeId: string) => {
    setSelectedNoteTypeId(newTypeId);
    const target = noteTypes.find((nt) => nt.id === newTypeId);
    if (!target) return;

    // Reset or map fields
    const updated: Record<string, string> = {};
    target.fields.forEach((f) => {
      updated[f.name] = fields[f.name] || '';
    });
    setFields(updated);
  };

  const handleFieldChange = (name: string, value: string) => {
    setFields((prev) => ({ ...prev, [name]: value }));
  };

  const handleSaveNote = () => {
    if (!selectedDeckId || !selectedNoteTypeId) return;

    const tags = tagsInput
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const notes = StorageService.getNotes();
    let noteToSave: Note;

    if (editNoteId) {
      const existing = notes.find((n) => n.id === editNoteId);
      if (!existing) return;
      noteToSave = {
        ...existing,
        deckId: selectedDeckId,
        noteTypeId: selectedNoteTypeId,
        fields,
        tags,
        updatedAt: Date.now(),
      };
      const updatedList = notes.map((n) => (n.id === editNoteId ? noteToSave : n));
      StorageService.saveNotes(updatedList);
    } else {
      noteToSave = {
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        deckId: selectedDeckId,
        noteTypeId: selectedNoteTypeId,
        fields,
        media: [],
        tags,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      StorageService.saveNotes([...notes, noteToSave]);
    }

    // Automatically synchronize corresponding Cards for FSRS
    StorageService.syncCardsForNote(noteToSave);
    AudioService.playHapticTone('flip');

    // Addon hook: note created/edited and persisted
    AddonSystem.runHook('onNoteSaved', {
      noteId: noteToSave.id,
      deckId: noteToSave.deckId,
      noteTypeId: noteToSave.noteTypeId,
      isNew: !editNoteId,
      note: noteToSave,
    });

    onSaved();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200"
      // close on backdrop press (mousedown, so text-selection drags don't close)
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              {editNoteId ? 'Editar Card / Nota' : 'Adicionar Novo Card'}
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Aceita texto, Ctrl+V para colar imagens e gravação de áudio em tempo real.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Deck & NoteType selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                Deck de Destino
              </label>
              <IOSSelect
                value={selectedDeckId}
                onChange={setSelectedDeckId}
                placeholder="Selecionar deck…"
                options={decks.map((d) => ({ value: d.id, label: d.name }))}
                className="w-full px-3.5 py-2.5 !rounded-2xl !bg-zinc-100 dark:!bg-zinc-800/80 !text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
                Tipo de Nota (Note Type)
              </label>
              <IOSSelect
                value={selectedNoteTypeId}
                onChange={handleNoteTypeChange}
                placeholder="Selecionar tipo…"
                options={noteTypes.map((nt) => ({
                  value: nt.id,
                  label: `${nt.name}${nt.isCloze ? ' (Cloze)' : ''}`,
                }))}
                className="w-full px-3.5 py-2.5 !rounded-2xl !bg-zinc-100 dark:!bg-zinc-800/80 !text-sm"
              />
            </div>
          </div>

          {/* Note Type Feature Badges */}
          {activeNoteType && (
            <div className="flex flex-wrap gap-2 text-[11px]">
              {activeNoteType.isCloze && (
                <span className="px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 font-semibold border border-purple-500/20">
                  Omissão Cloze Suportada
                </span>
              )}
              {activeNoteType.hintsEnabled && (
                <span className="px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold border border-amber-500/20">
                  💡 Botão Show Hint Habilitado
                </span>
              )}
              {activeNoteType.voiceRecordingEnabled && (
                <span className="px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 font-semibold border border-rose-500/20">
                  🎙️ Gravação de Voz Habilitada
                </span>
              )}
            </div>
          )}

          {/* Fields with Rich Media Embeds */}
          <div className="space-y-4">
            {activeNoteType?.fields.map((f) => {
              return (
                <RichMediaFieldEditor
                  key={f.id}
                  fieldName={f.name}
                  value={fields[f.name] || ''}
                  onChange={(newVal) => handleFieldChange(f.name, newVal)}
                  placeholder={f.description}
                  isHintField={f.name.toLowerCase() === 'hint'}
                  isClozeNoteType={Boolean(activeNoteType?.isCloze)}
                  description={f.description}
                />
              );
            })}
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              Tags (Separadas por espaço)
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="ex: anatomia cardio uff"
              className="w-full px-3.5 py-2.5 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-full text-sm font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSaveNote}
            className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm shadow-md transition-all active:scale-95"
          >
            <Check className="w-4 h-4" />
            <span>{editNoteId ? 'Salvar Alterações' : 'Salvar Card (FSRS)'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
