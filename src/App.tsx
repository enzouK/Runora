import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, FolderPlus, Inbox, GraduationCap, Repeat, Download, Upload } from 'lucide-react';
import { Deck, NoteType } from './types/anki';
import { StorageService } from './services/storage';
import { AddonSystem } from './services/addonSystem';
import { ExportImportService } from './services/exportImport';
import { Header, MainNavTab } from './components/navbar/Header';
import { DeckList } from './components/decks/DeckList';
import { DeckModal } from './components/decks/DeckModal';
import { ExportModal } from './components/decks/ExportModal';
import { StudyView } from './components/study/StudyView';
import { CardEditorModal } from './components/cards/CardEditorModal';
import { CardBrowser } from './components/cards/CardBrowser';
import { NoteTypeManager } from './components/notetypes/NoteTypeManager';
import { AddonsView } from './components/addons/AddonsView';
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
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
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

  // Global study summary across all decks (iOS Health-style strip)
  const totals = useMemo(() => {
    return decks.reduce(
      (acc, d) => {
        const c = StorageService.getDeckCounts(d.id);
        acc.new += c.newCount;
        acc.learning += c.learningCount;
        acc.review += c.reviewCount;
        return acc;
      },
      { new: 0, learning: 0, review: 0 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decks, refreshKey]);

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

  // Import a .colpkg/.apkg/.json from the home screen footer button
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const res = await ExportImportService.importPackage(file);
    setToast(res.message);
    refreshAll();
    e.target.value = '';
    setTimeout(() => setToast(null), 5000);
  };

  // If in review mode, render StudyView exclusively
  if (activeStudyDeck) {
    return (
      <div className="min-h-screen bg-ios-bg dark:bg-ios-bg-dark text-zinc-900 dark:text-zinc-100 font-sans selection:bg-ios-blue/20 selection:text-ios-blue">
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
    <div className="min-h-screen bg-ios-bg dark:bg-ios-bg-dark text-zinc-900 dark:text-zinc-100 font-sans selection:bg-ios-blue/20 selection:text-ios-blue flex flex-col">
      {/* Ambient top glow (subtle depth behind translucent surfaces) */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_55%_50%_at_50%_-12%,rgba(0,122,255,0.14),transparent)] dark:bg-[radial-gradient(ellipse_55%_50%_at_50%_-12%,rgba(64,156,255,0.14),transparent)]"
      />

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
          <div className="space-y-6 ios-fade-in">
            {/* iOS Large Title header */}
            <div className="flex items-end justify-between gap-4 px-1 pt-1">
              <h1 className="text-[32px] leading-none font-bold tracking-tight text-zinc-900 dark:text-white">
                Decks
              </h1>

              {/* Circular actions (iOS Files pattern) */}
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleOpenCreateDeck}
                  title="Novo Deck"
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-black/[0.06] dark:bg-white/[0.12] text-ios-blue hover:bg-black/[0.1] dark:hover:bg-white/[0.18] transition-all active:scale-90"
                >
                  <FolderPlus className="w-[18px] h-[18px]" />
                </button>
                <button
                  type="button"
                  onClick={handleOpenAddCard}
                  title="Novo Card (Ctrl+N)"
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-ios-blue text-white shadow-[0_2px_8px_rgba(0,122,255,0.4)] hover:bg-[#0071eb] transition-all active:scale-90"
                >
                  <Plus className="w-[18px] h-[18px]" strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {/* Study summary strip (iOS Health-style tinted cards) */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-[16px] p-4 bg-ios-blue/10 dark:bg-ios-blue/[0.16] border border-ios-blue/[0.12] dark:border-ios-blue/20">
                <div className="flex items-center gap-1.5 text-ios-blue">
                  <Inbox className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide">Novos</span>
                </div>
                <p className="text-[26px] leading-none font-bold tabular-nums text-zinc-900 dark:text-white mt-2.5">
                  {totals.new}
                </p>
              </div>

              <div className="rounded-[16px] p-4 bg-ios-orange/10 dark:bg-ios-orange/[0.16] border border-ios-orange/[0.12] dark:border-ios-orange/20">
                <div className="flex items-center gap-1.5 text-ios-orange">
                  <GraduationCap className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide">Aprendendo</span>
                </div>
                <p className="text-[26px] leading-none font-bold tabular-nums text-zinc-900 dark:text-white mt-2.5">
                  {totals.learning}
                </p>
              </div>

              <div className="rounded-[16px] p-4 bg-ios-green/10 dark:bg-ios-green/[0.16] border border-ios-green/[0.12] dark:border-ios-green/20">
                <div className="flex items-center gap-1.5 text-ios-green">
                  <Repeat className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide">Revisar</span>
                </div>
                <p className="text-[26px] leading-none font-bold tabular-nums text-zinc-900 dark:text-white mt-2.5">
                  {totals.review}
                </p>
              </div>
            </div>

            {/* iOS Inset Grouped Deck List */}
            <div className="rounded-[20px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)] overflow-hidden">
              <DeckList
                decks={decks}
                onSelectDeckToStudy={(deck) => {
                  AddonSystem.runHook('onDeckSelect', { deckId: deck.id, deckName: deck.name });
                  setActiveStudyDeck(deck);
                }}
                onEditDeck={handleEditDeck}
                onCreateSubdeck={handleCreateSubdeck}
                onRefresh={refreshAll}
              />
            </div>

            {/* Importar / Exportar — rodapé do menu inicial */}
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center justify-center gap-2 py-3 rounded-[16px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)] text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] cursor-pointer transition-all active:scale-[0.98]">
                <Download className="w-4 h-4 text-ios-blue" />
                <span>Importar</span>
                <input
                  type="file"
                  accept=".colpkg,.apkg,.json"
                  className="hidden"
                  onChange={handleImportFile}
                />
              </label>
              <button
                type="button"
                onClick={() => setIsExportModalOpen(true)}
                className="flex items-center justify-center gap-2 py-3 rounded-[16px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_1px_3px_rgba(0,0,0,0.05)] text-[13px] font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.05] transition-all active:scale-[0.98]"
              >
                <Upload className="w-4 h-4 text-ios-blue" />
                <span>Exportar</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'browser' && (
          <div className="ios-fade-in">
            <CardBrowser
              key={refreshKey}
              onEditNote={handleEditNoteFromBrowser}
              onRefresh={refreshAll}
            />
          </div>
        )}

        {activeTab === 'notetypes' && (
          <div className="ios-fade-in">
            <NoteTypeManager onRefresh={refreshAll} />
          </div>
        )}

        {activeTab === 'addons' && <AddonsView />}
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

      {/* Export picker (Anki-style deck selection + include options) */}
      <ExportModal isOpen={isExportModalOpen} onClose={() => setIsExportModalOpen(false)} />

      {/* Transient toast (import result, etc.) */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] max-w-[90vw] px-4 py-2.5 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-[13px] font-semibold shadow-[0_4px_20px_rgba(0,0,0,0.3)] ios-fade-in text-center">
          {toast}
        </div>
      )}

      {/* Settings & FSRS Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        onRefresh={refreshAll}
      />
    </div>
  );
}
