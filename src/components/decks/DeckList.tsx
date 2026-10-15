import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Plus,
  MoreVertical,
  Play,
  Settings,
  Trash2,
  Edit2,
  Sparkles,
} from 'lucide-react';
import { Deck } from '../../types/anki';
import { DeckTreeNode, DeckService } from '../../services/deckService';
import { StorageService } from '../../services/storage';
import { ConfirmationModal } from '../common/ConfirmationModal';

interface DeckListProps {
  decks: Deck[];
  onSelectDeckToStudy: (deck: Deck) => void;
  onEditDeck: (deck: Deck) => void;
  onCreateSubdeck: (parentDeckName: string) => void;
  onRefresh: () => void;
}

export const DeckList: React.FC<DeckListProps> = ({
  decks,
  onSelectDeckToStudy,
  onEditDeck,
  onCreateSubdeck,
  onRefresh,
}) => {
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [activeMenu, setActiveMenu] = useState<{
    deck: Deck;
    fullName: string;
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [deckToDelete, setDeckToDelete] = useState<{ id: string; name: string } | null>(null);

  // Close the context menu on any outside click, scroll or Escape
  useEffect(() => {
    if (!activeMenu) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveMenu(null);
    };
    const handleScroll = () => setActiveMenu(null);
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [activeMenu]);

  const treeNodes = DeckService.buildDeckTree(decks);

  const toggleCollapse = (deckName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedMap((prev) => ({ ...prev, [deckName]: !prev[deckName] }));
  };

  const handleDeleteClick = (deck: { id: string; name: string }, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveMenu(null);
    setDeckToDelete(deck);
  };

  const handleConfirmDelete = () => {
    if (deckToDelete) {
      StorageService.deleteDeck(deckToDelete.id);
      setDeckToDelete(null);
      onRefresh();
    }
  };

  const renderNode = (node: DeckTreeNode) => {
    const isCollapsed = collapsedMap[node.fullName] ?? false;
    const hasChildren = node.children.length > 0;
    const { counts } = node;
    const totalDue = counts.newCount + counts.learningCount + counts.reviewCount;

    return (
      <div key={node.deck.id} className="w-full">
        <div
          onClick={() => onSelectDeckToStudy(node.deck)}
          className={`group flex items-center justify-between py-3.5 px-4 rounded-2xl transition-all cursor-pointer select-none hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60 active:scale-[0.99] border border-transparent hover:border-zinc-200/60 dark:hover:border-zinc-700/40`}
          style={{ paddingLeft: `${node.level * 20 + 16}px` }}
        >
          {/* Left: Expand toggle + Folder Icon + Title */}
          <div className="flex items-center gap-2.5 min-w-0">
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => toggleCollapse(node.fullName, e)}
                className="p-1 rounded-lg hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60 text-zinc-400 transition-colors -ml-1"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
            ) : (
              <div className="w-6" />
            )}

            <div className="w-8 h-8 rounded-xl bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              {hasChildren ? (
                isCollapsed ? <Folder className="w-4 h-4" /> : <FolderOpen className="w-4 h-4" />
              ) : (
                <Folder className="w-4 h-4" />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate">
                  {node.shortName}
                </span>
                {node.deck.fsrsParams?.requestRetention && (
                  <span className="hidden sm:inline-flex text-[10px] font-mono px-1.5 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border border-zinc-200 dark:border-zinc-700">
                    {Math.round(node.deck.fsrsParams.requestRetention * 100)}% FSRS
                  </span>
                )}
              </div>
              {node.deck.description && (
                <p className="text-[11px] text-zinc-400 truncate max-w-xs">
                  {node.deck.description}
                </p>
              )}
            </div>
          </div>

          {/* Right: Anki Tri-color Counters & Actions */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Tri-color counts (New, Learn, Due) */}
            <div className="flex items-center gap-1.5 font-mono text-xs font-semibold">
              <span
                className={`w-7 text-center py-0.5 rounded-md ${
                  counts.newCount > 0
                    ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40'
                    : 'text-zinc-300 dark:text-zinc-600'
                }`}
                title="Cards Novos"
              >
                {counts.newCount}
              </span>
              <span
                className={`w-7 text-center py-0.5 rounded-md ${
                  counts.learningCount > 0
                    ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40'
                    : 'text-zinc-300 dark:text-zinc-600'
                }`}
                title="Aprendizado / Reaprendizado"
              >
                {counts.learningCount}
              </span>
              <span
                className={`w-7 text-center py-0.5 rounded-md ${
                  counts.reviewCount > 0
                    ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40'
                    : 'text-zinc-300 dark:text-zinc-600'
                }`}
                title="Revisões Vencidas"
              >
                {counts.reviewCount}
              </span>
            </div>

            {/* Quick Study Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectDeckToStudy(node.deck);
              }}
              className="hidden sm:flex items-center gap-1 px-3 py-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-all active:scale-95"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Estudar</span>
            </button>

            {/* Context menu trigger */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (activeMenu?.deck.id === node.deck.id) {
                  setActiveMenu(null);
                } else {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const menuHeight = 130; // approx. height of the dropdown
                  const openUpward = rect.bottom + menuHeight > window.innerHeight;
                  setActiveMenu({
                    deck: node.deck,
                    fullName: node.fullName,
                    x: Math.min(rect.right - 176, window.innerWidth - 192),
                    y: openUpward ? rect.top - menuHeight - 6 : rect.bottom + 6,
                  });
                }
              }}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-700/50 transition-colors"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Subdecks recursive rendering */}
        {hasChildren && !isCollapsed && (
          <div className="relative">
            <div
              className="absolute left-6 top-0 bottom-0 w-px bg-zinc-200/60 dark:bg-zinc-800/60"
              style={{ left: `${node.level * 20 + 28}px` }}
            />
            {node.children.map((child) => renderNode(child))}
          </div>
        )}
      </div>
    );
  };

  if (decks.length === 0) {
    return (
      <div className="text-center py-16 px-4">
        <Folder className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
        <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Nenhum deck criado ainda
        </p>
        <p className="text-xs text-zinc-400 max-w-xs mx-auto mt-1 mb-4">
          Crie seu primeiro deck para começar a organizar seus flashcards com agendamento FSRS.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Legend bar */}
      <div className="flex items-center justify-between px-4 py-2 text-[11px] text-zinc-400 font-medium border-b border-zinc-100 dark:border-zinc-800/80 mb-2">
        <span>Deck</span>
        <div className="flex items-center gap-4 pr-10">
          <span className="text-blue-600 dark:text-blue-400 font-semibold">Novo</span>
          <span className="text-amber-600 dark:text-amber-400 font-semibold">Aprender</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Revisar</span>
        </div>
      </div>

      <div className="space-y-0.5">{treeNodes.map((node) => renderNode(node))}</div>

      {/* Portal context menu: never clipped or covered by deck rows */}
      {activeMenu &&
        createPortal(
          <div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: activeMenu.x, top: activeMenu.y, zIndex: 60 }}
            className="w-44 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl p-1.5 text-xs text-zinc-700 dark:text-zinc-200 animate-in fade-in zoom-in-95 duration-150"
          >
            <button
              type="button"
              onClick={() => {
                const fullName = activeMenu.fullName;
                setActiveMenu(null);
                onCreateSubdeck(fullName);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left"
            >
              <Plus className="w-3.5 h-3.5 text-blue-500" />
              <span>Criar Subdeck</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const deck = activeMenu.deck;
                setActiveMenu(null);
                onEditDeck(deck);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-left"
            >
              <Edit2 className="w-3.5 h-3.5 text-amber-500" />
              <span>Opções / FSRS</span>
            </button>

            <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />

            <button
              type="button"
              onClick={(e) =>
                handleDeleteClick({ id: activeMenu.deck.id, name: activeMenu.deck.name }, e)
              }
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-red-50 dark:hover:bg-red-950/40 text-red-600 dark:text-red-400 transition-colors text-left"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Excluir Deck</span>
            </button>
          </div>,
          document.body
        )}

      <ConfirmationModal
        isOpen={!!deckToDelete}
        onClose={() => setDeckToDelete(null)}
        onConfirm={handleConfirmDelete}
        title="Excluir Baralho?"
        description="Esta ação é permanente e irreversível. Todos os cards, notas e sub-baralhos contidos neste baralho serão completamente removidos."
        highlightItem={deckToDelete ? deckToDelete.name : undefined}
        confirmText="Excluir Baralho"
        cancelText="Cancelar"
        variant="danger"
      />
    </div>
  );
};
