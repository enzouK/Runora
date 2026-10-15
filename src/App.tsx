import React, { useState, useEffect, useCallback } from 'react';
import { Plus, FolderPlus, Sparkles, BookOpen, Layers } from 'lucide-react';
import { Deck, NoteType } from './types/anki';
import { StorageService } from './services/storage';
import { Header, MainNavTab } from './components/navbar/Header';
import { DeckList } from './components/decks/DeckList';
import { DeckModal } from './components/decks/DeckModal';
import { StudyView } from './components/study/StudyView';
import { CardEditorModal } from './components/cards/CardEditorModal';
import { CardBrowser } from './components/cards/CardBrowser';
import { NoteTypeManager } from './components/notetypes/NoteTypeManager';
import { SettingsModal } from './components/settings/SettingsModal';

export default function App() {
  const [activeTab, setActiveTab] = useState<MainNavTab>('decks');
  const [decks, setDecks] = useState<Deck[]>(() => StorageService.getDecks());
  const [activeStudyDeck, setActiveStudyDeck] = useState<Deck | null>(null);

  // Modals state
  const [isAddCardModalOpen, setIsAddCardModalOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [isDeckModalOpen, setIsDeckModalOpen] = useState(false);
  const [editingDeck, setEditingDeck] = useState<Deck | null>(null);
  const [parentDeckNameForSubdeck, setParentDeckNameForSubdeck] = useState<string | undefined>(undefined);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refreshAll = useCallback(() => {
    setDecks(StorageService.getDecks());
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Global keyboard shortcuts (e.g. Ctrl+N to add card)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setEditingNoteId(null);
        setIsAddCardModalOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleOpenAddCard = () => {
    setEditingNoteId(null);
    setIsAddCardModalOpen(true);
  };

  const handleOpenCreateDeck = () => {
    setEditingDeck(null);
    setParentDeckNameForSubdeck(undefined);
    setIsDeckModalOpen(true);
  };

  const handleCreateSubdeck = (parentName: string) => {
    setEditingDeck(null);
    setParentDeckNameForSubdeck(parentName);
    setIsDeckModalOpen(true);
  };

  const handleEditDeck = (deck: Deck) => {
    setEditingDeck(deck);
    setParentDeckNameForSubdeck(undefined);
    setIsDeckModalOpen(true);
  };

  const handleEditNoteFromBrowser = (noteId: string) => {
    setEditingNoteId(noteId);
    setIsAddCardModalOpen(true);
  };

  // If in review mode, render StudyView exclusively
  if (activeStudyDeck) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans selection:bg-blue-500/20 selection:text-blue-600">
        <StudyView
          deck={activeStudyDeck}
          onBack={() => {
            setActiveStudyDeck(null);
            refreshAll();
          }}
          onReviewFinished={() => {
            refreshAll();
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50/80 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans selection:bg-blue-500/20 selection:text-blue-600 flex flex-col">
      {/* Top iOS Header */}
      <Header
        activeTab={activeTab}
        onTabChange={(tab) => setActiveTab(tab)}
        onOpenAddCard={handleOpenAddCard}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onNewDeck={handleOpenCreateDeck}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-6">
        {activeTab === 'decks' && (
          <div className="space-y-5 animate-in fade-in duration-200">
            {/* iOS Inset Card Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800/90 shadow-sm">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
                    Seus Decks de Estudo
                  </h2>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-semibold border border-blue-200 dark:border-blue-800">
                    FSRS Nativo
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Clique em um deck para iniciar a revisão ou use os botões de ação para subdecks.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleOpenCreateDeck}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-semibold transition-all active:scale-95"
                >
                  <FolderPlus className="w-4 h-4 text-blue-500" />
                  <span>Novo Deck</span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenAddCard}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-all active:scale-95"
                >
                  <Plus className="w-4 h-4" />
                  <span>Novo Card</span>
                </button>
              </div>
            </div>

            {/* Hierarchical Deck List Container */}
            <div className="p-2 sm:p-4 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800/90 shadow-sm">
              <DeckList
                decks={decks}
                onSelectDeckToStudy={(deck) => setActiveStudyDeck(deck)}
                onEditDeck={handleEditDeck}
                onCreateSubdeck={handleCreateSubdeck}
                onRefresh={refreshAll}
              />
            </div>

            {/* FSRS Architecture Explanation Footer Badge */}
            <div className="p-4 rounded-2xl bg-zinc-100/70 dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800/60 flex items-start gap-3 text-xs text-zinc-500 dark:text-zinc-400">
              <Sparkles className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                  Algoritmo FSRS-4.5 / FSRS-5 Ativo:
                </span>{' '}
                Sem SM-2. Cada card possui estabilidade contínua e curva de esquecimento calculada diretamente da retenção alvo configurada (90%). Cards com Voice Recording habilitado exibem o botão de gravação na frente e comparação direta no verso.
              </div>
            </div>
          </div>
        )}

        {activeTab === 'browser' && (
          <div className="animate-in fade-in duration-200">
            <CardBrowser
              key={refreshKey}
              onEditNote={handleEditNoteFromBrowser}
              onRefresh={refreshAll}
            />
          </div>
        )}

        {activeTab === 'notetypes' && (
          <div className="animate-in fade-in duration-200">
            <NoteTypeManager onRefresh={refreshAll} />
          </div>
        )}
      </main>

      {/* Card & Note Editor Modal */}
      <CardEditorModal
        isOpen={isAddCardModalOpen}
        onClose={() => setIsAddCardModalOpen(false)}
        onSaved={refreshAll}
        editNoteId={editingNoteId}
      />

      {/* Deck Creator / Editor Modal */}
      <DeckModal
        isOpen={isDeckModalOpen}
        onClose={() => setIsDeckModalOpen(false)}
        onSaved={refreshAll}
        editDeck={editingDeck}
        parentDeckName={parentDeckNameForSubdeck}
      />

      {/* Settings & FSRS Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        onRefresh={refreshAll}
      />
    </div>
  );
}
