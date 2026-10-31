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
  Trash2,
  Edit2,
} from 'lucide-react';
import { Deck } from '../../types/anki';
import { DeckTreeNode, DeckService } from '../../services/deckService';
import { StorageService } from '../../services/storage';
import { AddonSystem } from '../../services/addonSystem';
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
      // Addon hook: deck deleted
      AddonSystem.runHook('onDeckDeleted', { deckId: deckToDelete.id, deckName: deckToDelete.name });
      setDeckToDelete(null);
      onRefresh();
    }
  };

  const renderNode = (node: DeckTreeNode) => {
    const isCollapsed = collapsedMap[node.fullName] ?? false;
    const hasChildren = node.children.length > 0;
    const { counts } = node;

    return (
      <div key={node.deck.id} className="w-full">
        <div
          onClick={() => onSelectDeckToStudy(node.deck)}
          className="group flex items-center justify-between py-3 pr-3 cursor-pointer select-none transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
          style={{ paddingLeft: `${node.level * 24 + 16}px` }}
        >
          {/* Left: Expand toggle + Folder Icon + Title */}
          <div className="flex items-center gap-2 min-w-0">
            {hasChildren ? (
              <button
                type="button"
                onClick={(e) => toggleCollapse(node.fullName, e)}
                className="p-1 -ml-1 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
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

            {/* iOS Files-style blue folder glyph */}
            <div className="w-6 flex items-center justify-center shrink-0">
              {hasChildren && !isCollapsed ? (
                <FolderOpen className="w-5 h-5 text-ios-blue" fill="currentColor" strokeWidth={0} />
              ) : (
                <Folder className="w-5 h-5 text-ios-blue" fill="currentColor" strokeWidth={0} />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[15px] text-zinc-900 dark:text-zinc-50 truncate">
                  {node.shortName}
                </span>
                <span
                  className="hidden sm:inline shrink-0 px-1.5 py-0.5 rounded-full bg-ios-blue/10 dark:bg-ios-blue/[0.18] text-[10px] font-bold tracking-wide text-ios-blue"
                  title="FSRS: retenção alvo deste deck (preset ou override deste deck)"
                >
                  FSRS {Math.round(
                    (node.deck.fsrsOverride?.requestRetention ??
                      StorageService.getDeckPreset(node.deck.id).fsrsParams.requestRetention) * 100
                  )}%
                </span>
              </div>
              {node.deck.description && (
                <p className="text-[12px] text-zinc-400 dark:text-zinc-500 truncate max-w-xs leading-tight mt-px">
                  {node.deck.description}
                </p>
              )}
            </div>
          </div>

          {/* Right: iOS colored counters & actions */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Runora tri-color counts (plain iOS numbers) */}
            <div className="flex items-center gap-3 text-[15px] font-medium tabular-nums pr-1">
              <span
                className={`w-6 text-center ${
                  counts.newCount > 0 ? 'text-ios-blue' : 'text-zinc-300 dark:text-zinc-600'
                }`}
                title="Cards Novos"
              >
                {counts.newCount}
              </span>
              <span
                className={`w-6 text-center ${
                  counts.learningCount > 0 ? 'text-ios-orange' : 'text-zinc-300 dark:text-zinc-600'
                }`}
                title="Aprendizado / Reaprendizado"
              >
                {counts.learningCount}
              </span>
              <span
                className={`w-6 text-center ${
                  counts.reviewCount > 0 ? 'text-ios-green' : 'text-zinc-300 dark:text-zinc-600'
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
              className="hidden sm:flex items-center gap-1 px-3 py-1 rounded-full bg-ios-blue hover:bg-[#0071eb] text-white text-[12px] font-semibold transition-all active:scale-95"
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
              className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] transition-colors"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Subdecks recursive rendering */}
        {hasChildren && !isCollapsed && (
          <div className="relative">
            <div
              className="absolute top-0 bottom-0 w-px bg-black/[0.07] dark:bg-white/[0.08]"
              style={{ left: `${node.level * 24 + 26}px` }}
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
        <Folder className="w-10 h-10 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" strokeWidth={1.5} />
        <p className="text-[15px] font-semibold text-zinc-800 dark:text-zinc-200">
          Nenhum deck criado ainda
        </p>
        <p className="text-[13px] text-zinc-400 dark:text-zinc-500 max-w-xs mx-auto mt-1 mb-4">
          Crie seu primeiro deck para começar a organizar seus flashcards com agendamento FSRS.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Root-level hairline separators (iOS inset grouped feel) */}
      <div className="divide-y divide-black/[0.05] dark:divide-white/[0.07]">
        {treeNodes.map((node) => renderNode(node))}
      </div>

      {/* Portal context menu: never clipped or covered by deck rows */}
      {activeMenu &&
        createPortal(
          <div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', left: activeMenu.x, top: activeMenu.y, zIndex: 60 }}
            className="w-48 rounded-[14px] bg-white/95 dark:bg-[#2c2c2e]/95 backdrop-blur-xl border border-black/[0.08] dark:border-white/[0.1] shadow-[0_10px_40px_rgba(0,0,0,0.18)] p-1.5 text-[13px] text-zinc-800 dark:text-zinc-100 ios-fade-in"
          >
            <button
              type="button"
              onClick={() => {
                const fullName = activeMenu.fullName;
                setActiveMenu(null);
                onCreateSubdeck(fullName);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[9px] hover:bg-black/[0.05] dark:hover:bg-white/[0.1] transition-colors text-left"
            >
              <Plus className="w-4 h-4 text-ios-blue" />
              <span>Criar Subdeck</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const deck = activeMenu.deck;
                setActiveMenu(null);
                onEditDeck(deck);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[9px] hover:bg-black/[0.05] dark:hover:bg-white/[0.1] transition-colors text-left"
            >
              <Edit2 className="w-4 h-4 text-ios-orange" />
              <span>Opções / FSRS</span>
            </button>

            <div className="my-1 border-t border-black/[0.06] dark:border-white/[0.08]" />

            <button
              type="button"
              onClick={(e) =>
                handleDeleteClick({ id: activeMenu.deck.id, name: activeMenu.deck.name }, e)
              }
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[9px] hover:bg-ios-red/10 text-ios-red transition-colors text-left"
            >
              <Trash2 className="w-4 h-4" />
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
