import React, { useState, useMemo } from 'react';
import { Search, Filter, Trash2, Edit3, Sparkles, Folder, Tag } from 'lucide-react';
import { Card, Deck, Note, NoteType } from '../../types/anki';
import { StorageService } from '../../services/storage';
import { FSRS } from '../../fsrs/algorithm';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { IOSSelect } from '../common/IOSSelect';

interface CardBrowserProps {
  onEditNote: (noteId: string) => void;
  onRefresh: () => void;
}

export const CardBrowser: React.FC<CardBrowserProps> = ({ onEditNote, onRefresh }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDeckFilter, setSelectedDeckFilter] = useState('all');
  const [selectedStateFilter, setSelectedStateFilter] = useState('all');
  const [cardToDelete, setCardToDelete] = useState<{
    card: Card;
    preview: string;
    deckName: string;
  } | null>(null);

  const decks = useMemo(() => StorageService.getDecks(), []);
  const noteTypes = useMemo(() => StorageService.getNoteTypes(), []);
  const notes = useMemo(() => StorageService.getNotes(), [onRefresh]);
  const cards = useMemo(() => StorageService.getCards(), [onRefresh]);

  const noteMap = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);
  const deckMap = useMemo(() => new Map(decks.map((d) => [d.id, d])), [decks]);
  const noteTypeMap = useMemo(() => new Map(noteTypes.map((nt) => [nt.id, nt])), [noteTypes]);

  const fsrsEngine = useMemo(() => new FSRS(StorageService.getFSRSSettings()), []);

  // Filtered card items
  const filteredCards = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return cards.filter((card) => {
      const note = noteMap.get(card.noteId);
      if (!note) return false;

      // Deck filter
      if (selectedDeckFilter !== 'all' && card.deckId !== selectedDeckFilter) {
        return false;
      }

      // State filter
      if (selectedStateFilter !== 'all') {
        const stateNum = parseInt(selectedStateFilter, 10);
        if (card.fsrs.state !== stateNum) return false;
      }

      // Search text in fields or tags
      if (q) {
        const fieldsText = Object.values(note.fields).join(' ').toLowerCase();
        const tagsText = note.tags.join(' ').toLowerCase();
        if (!fieldsText.includes(q) && !tagsText.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [cards, noteMap, searchQuery, selectedDeckFilter, selectedStateFilter]);

  const handleDeleteCardClick = (
    card: Card,
    preview: string,
    deckName: string,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setCardToDelete({ card, preview, deckName });
  };

  const handleConfirmDelete = () => {
    if (cardToDelete) {
      StorageService.deleteNote(cardToDelete.card.noteId);
      setCardToDelete(null);
      onRefresh();
    }
  };

  return (
    <div className="space-y-4">
      {/* Search and Filters Bar */}
      <div className="p-4 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800/90 shadow-sm space-y-3">
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm">
          <Search className="w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Pesquisar em perguntas, respostas, tags..."
            className="flex-1 bg-transparent border-none outline-none text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 text-xs sm:text-sm"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-xs text-zinc-400 hover:text-zinc-600"
            >
              Limpar
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <Filter className="w-3.5 h-3.5" />
            <span>Deck:</span>
            <IOSSelect
              value={selectedDeckFilter}
              onChange={setSelectedDeckFilter}
              options={[
                { value: 'all', label: `Todos os Decks (${cards.length})` },
                ...decks.map((d) => ({ value: d.id, label: d.name })),
              ]}
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span>Status FSRS:</span>
            <IOSSelect
              value={selectedStateFilter}
              onChange={setSelectedStateFilter}
              options={[
                { value: 'all', label: 'Todos os Estados' },
                { value: '0', label: 'Novo (New)' },
                { value: '1', label: 'Aprendizado (Learning)' },
                { value: '2', label: 'Revisão (Review)' },
                { value: '3', label: 'Reaprendizado (Relearning)' },
              ]}
            />
          </div>

          <div className="ml-auto text-xs font-mono text-zinc-400">
            {filteredCards.length} cards encontrados
          </div>
        </div>
      </div>

      {/* Cards Table / List */}
      <div className="space-y-2">
        {filteredCards.length === 0 ? (
          <div className="text-center py-12 text-zinc-400 text-xs">
            Nenhum card corresponde aos critérios da busca.
          </div>
        ) : (
          filteredCards.map((card) => {
            const note = noteMap.get(card.noteId);
            const deck = deckMap.get(card.deckId);
            const noteType = note ? noteTypeMap.get(note.noteTypeId) : null;
            if (!note) return null;

            const firstField = Object.values(note.fields)[0] || '';
            const secondField = Object.values(note.fields)[1] || '';
            const strippedFirst = firstField.replace(/<[^>]+>/g, '').slice(0, 120);
            const strippedSecond = secondField.replace(/<[^>]+>/g, '').slice(0, 80);

            const r =
              card.fsrs.stability > 0
                ? (fsrsEngine.retrievability(card.fsrs.elapsedDays, card.fsrs.stability) * 100).toFixed(0) + '%'
                : '100%';

            return (
              <div
                key={card.id}
                onClick={() => onEditNote(note.id)}
                className="group p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 hover:border-blue-400/60 dark:hover:border-blue-500/60 transition-all cursor-pointer shadow-sm hover:shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                {/* Content preview */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
                      {deck?.name || 'Deck'}
                    </span>
                    <span className="text-[10px] text-zinc-400">
                      {noteType?.name || 'Nota'}
                    </span>
                    {note.tags.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>

                  <div className="font-medium text-xs sm:text-sm text-zinc-900 dark:text-zinc-100 line-clamp-1">
                    {strippedFirst || 'Card sem texto'}
                  </div>
                  {strippedSecond && (
                    <div className="text-xs text-zinc-400 line-clamp-1 mt-0.5">
                      {strippedSecond}
                    </div>
                  )}
                </div>

                {/* FSRS Stats Pills */}
                <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
                  <div
                    className="px-2 py-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                    title="Estabilidade FSRS (dias de memória)"
                  >
                    <span className="text-zinc-400 text-[10px] mr-1">S:</span>
                    <span className="font-bold text-blue-600 dark:text-blue-400">
                      {card.fsrs.stability.toFixed(1)}d
                    </span>
                  </div>

                  <div
                    className="px-2 py-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300"
                    title="Dificuldade FSRS (1 a 10)"
                  >
                    <span className="text-zinc-400 text-[10px] mr-1">D:</span>
                    <span className="font-bold text-amber-600 dark:text-amber-400">
                      {card.fsrs.difficulty.toFixed(1)}
                    </span>
                  </div>

                  <div
                    className="px-2 py-1 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hidden md:block"
                    title="Retrievability (Probabilidade de Lembrança)"
                  >
                    <span className="text-zinc-400 text-[10px] mr-1">R:</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">{r}</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditNote(note.id);
                      }}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                      title="Editar"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) =>
                        handleDeleteCardClick(
                          card,
                          strippedFirst || 'Card sem título',
                          deck?.name || 'Deck',
                          e
                        )
                      }
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                      title="Excluir"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <ConfirmationModal
        isOpen={!!cardToDelete}
        onClose={() => setCardToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Excluir Flashcard?"
        description="Esta ação excluirá este cartão e a respectiva nota original do seu banco de dados."
        highlightItem={
          cardToDelete
            ? `[${cardToDelete.deckName}] ${cardToDelete.preview}`
            : undefined
        }
        confirmText="Excluir Card"
        cancelText="Cancelar"
        variant="danger"
      />
    </div>
  );
};
