import React, { useState, useEffect } from 'react';
import {
  X,
  Check,
  CalendarClock,
  Sparkle,
  RotateCcw,
  GraduationCap,
  ListOrdered,
  ArrowDownUp,
  AlertTriangle,
  BellRing,
  Hand,
  ArrowUpDown,
  Layers,
  Blend,
  TimerReset,
  SortAsc,
  Volume2,
  Hourglass,
} from 'lucide-react';
import {
  Deck,
  DisplayOrderConfig,
  MixOrder,
  NewGatherOrder,
  NewSortOrder,
  ReviewSortOrder,
} from '../../types/anki';
import { StorageService } from '../../services/storage';
import { IOSSelect } from '../common/IOSSelect';

interface DeckModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  editDeck?: Deck | null;
  parentDeckName?: string;
}

export const DeckModal: React.FC<DeckModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  editDeck,
  parentDeckName,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetRetention, setTargetRetention] = useState(0.90);
  const [maxInterval, setMaxInterval] = useState('');
  const [newCardsPerDay, setNewCardsPerDay] = useState('');
  const [maxReviewsPerDay, setMaxReviewsPerDay] = useState('');
  // Scheduler options (Anki): '' / 'inherit' = herdar do pai ou do padrão
  const [learningSteps, setLearningSteps] = useState('');
  const [insertionOrder, setInsertionOrder] = useState<'inherit' | 'sequential' | 'random'>('inherit');
  const [relearningSteps, setRelearningSteps] = useState('');
  const [leechThreshold, setLeechThreshold] = useState('');
  const [leechAction, setLeechAction] = useState<'inherit' | 'suspend' | 'tag'>('inherit');
  // Display Order (Anki): 'inherit' = herdar do pai ou do padrão
  const [newGatherOrder, setNewGatherOrder] = useState<'inherit' | NewGatherOrder>('inherit');
  const [newSortOrder, setNewSortOrder] = useState<'inherit' | NewSortOrder>('inherit');
  const [newReviewOrder, setNewReviewOrder] = useState<'inherit' | MixOrder>('inherit');
  const [learnReviewOrder, setLearnReviewOrder] = useState<'inherit' | MixOrder>('inherit');
  const [reviewSortOrder, setReviewSortOrder] = useState<'inherit' | ReviewSortOrder>('inherit');
  // Audio (Anki): 'inherit' = herdar do pai ou do padrão
  const [audioAutoplay, setAudioAutoplay] = useState<'inherit' | 'play' | 'dont'>('inherit');

  useEffect(() => {
    if (!isOpen) return;
    if (editDeck) {
      setName(editDeck.name);
      setDescription(editDeck.description);
      setTargetRetention(editDeck.fsrsParams?.requestRetention ?? 0.90);
      setMaxInterval(editDeck.fsrsParams?.maximumInterval?.toString() ?? '');
      setNewCardsPerDay(editDeck.dailyLimits?.newCardsPerDay?.toString() ?? '');
      setMaxReviewsPerDay(editDeck.dailyLimits?.maxReviewsPerDay?.toString() ?? '');
      setLearningSteps(editDeck.schedulerConfig?.learningSteps ?? '');
      setInsertionOrder(editDeck.schedulerConfig?.insertionOrder ?? 'inherit');
      setRelearningSteps(editDeck.schedulerConfig?.relearningSteps ?? '');
      setLeechThreshold(editDeck.schedulerConfig?.leechThreshold?.toString() ?? '');
      setLeechAction(editDeck.schedulerConfig?.leechAction ?? 'inherit');
      setNewGatherOrder(editDeck.displayOrder?.newGatherOrder ?? 'inherit');
      setNewSortOrder(editDeck.displayOrder?.newSortOrder ?? 'inherit');
      setNewReviewOrder(editDeck.displayOrder?.newReviewOrder ?? 'inherit');
      setLearnReviewOrder(editDeck.displayOrder?.learnReviewOrder ?? 'inherit');
      setReviewSortOrder(editDeck.displayOrder?.reviewSortOrder ?? 'inherit');
      setAudioAutoplay(
        editDeck.audioConfig?.disableAutoplay === true
          ? 'dont'
          : editDeck.audioConfig?.disableAutoplay === false
            ? 'play'
            : 'inherit'
      );
    } else if (parentDeckName) {
      setName(`${parentDeckName}::`);
      setDescription('');
      setTargetRetention(0.90);
      setMaxInterval('');
      setNewCardsPerDay('');
      setMaxReviewsPerDay('');
      setLearningSteps('');
      setInsertionOrder('inherit');
      setRelearningSteps('');
      setLeechThreshold('');
      setLeechAction('inherit');
      setNewGatherOrder('inherit');
      setNewSortOrder('inherit');
      setNewReviewOrder('inherit');
      setLearnReviewOrder('inherit');
      setReviewSortOrder('inherit');
      setAudioAutoplay('inherit');
    } else {
      setName('');
      setDescription('');
      setTargetRetention(0.90);
      setMaxInterval('');
      setNewCardsPerDay('');
      setMaxReviewsPerDay('');
      setLearningSteps('');
      setInsertionOrder('inherit');
      setRelearningSteps('');
      setLeechThreshold('');
      setLeechAction('inherit');
      setNewGatherOrder('inherit');
      setNewSortOrder('inherit');
      setNewReviewOrder('inherit');
      setLearnReviewOrder('inherit');
      setReviewSortOrder('inherit');
      setAudioAutoplay('inherit');
    }
  }, [isOpen, editDeck, parentDeckName]);

  const parseLimit = (value: string): number | null => {
    if (value.trim() === '') return null;
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const handleSave = () => {
    if (!name.trim()) return;

    const decks = StorageService.getDecks();
    const dailyLimits = {
      newCardsPerDay: parseLimit(newCardsPerDay),
      maxReviewsPerDay: parseLimit(maxReviewsPerDay),
    };
    const schedulerConfig = {
      learningSteps: learningSteps.trim() || null,
      insertionOrder: insertionOrder === 'inherit' ? null : insertionOrder,
      relearningSteps: relearningSteps.trim() || null,
      leechThreshold: parseLimit(leechThreshold),
      leechAction: leechAction === 'inherit' ? null : leechAction,
    };
    const displayOrder: DisplayOrderConfig = {
      newGatherOrder: newGatherOrder === 'inherit' ? null : newGatherOrder,
      newSortOrder: newSortOrder === 'inherit' ? null : newSortOrder,
      newReviewOrder: newReviewOrder === 'inherit' ? null : newReviewOrder,
      learnReviewOrder: learnReviewOrder === 'inherit' ? null : learnReviewOrder,
      reviewSortOrder: reviewSortOrder === 'inherit' ? null : reviewSortOrder,
    };
    const audioConfig = {
      disableAutoplay: audioAutoplay === 'inherit' ? null : audioAutoplay === 'dont',
    };
    // Per-deck FSRS overrides: only fields the user set are saved;
    // anything left empty falls back to the global settings at runtime.
    const fsrsParams: { requestRetention: number; maximumInterval?: number } = {
      requestRetention: targetRetention,
    };
    const parsedMaxInterval = parseInt(maxInterval, 10);
    if (Number.isFinite(parsedMaxInterval) && parsedMaxInterval > 0) {
      fsrsParams.maximumInterval = parsedMaxInterval;
    }

    if (editDeck) {
      const updated = decks.map((d) =>
        d.id === editDeck.id
          ? {
              ...d,
              name: name.trim(),
              description: description.trim(),
              fsrsParams,
              dailyLimits,
              schedulerConfig,
              displayOrder,
              audioConfig,
              updatedAt: Date.now(),
            }
          : d
      );
      StorageService.saveDecks(updated);
    } else {
      const newDeck: Deck = {
        id: `deck-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim(),
        description: description.trim(),
        fsrsParams: { requestRetention: targetRetention },
        dailyLimits,
        schedulerConfig,
        displayOrder,
        audioConfig,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      StorageService.saveDecks([...decks, newDeck]);
    }

    onSaved();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            {editDeck ? 'Editar Deck' : 'Criar Novo Deck'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-full text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              Nome do Deck
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: Idiomas::Inglês::Vocabulário"
              className="w-full px-3.5 py-2.5 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[11px] text-zinc-400 mt-1">
              Dica: Use "::" para criar subdecks hierárquicos (ex: Biologia::Celular).
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">
              Descrição
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Objetivo de estudo deste deck..."
              className="w-full px-3.5 py-2.5 rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Retenção FSRS Desejada
              </label>
              <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">
                {Math.round(targetRetention * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.70"
              max="0.98"
              step="0.01"
              value={targetRetention}
              onChange={(e) => setTargetRetention(parseFloat(e.target.value))}
              className="w-full accent-blue-600 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-zinc-400 mt-0.5">
              <span>70% (Menos revisões)</span>
              <span>90% (Padrão)</span>
              <span>98% (Alta retenção)</span>
            </div>
          </div>

          {/* ── Intervalo Máximo (FSRS por deck; vazio = global) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Hourglass className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Intervalo Máximo
              </label>
            </div>

            <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 overflow-hidden">
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Hourglass className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Máx. dias por intervalo
                  </span>
                </div>
                <input
                  type="number"
                  min="30"
                  max="36500"
                  value={maxInterval}
                  onChange={(e) => setMaxInterval(e.target.value)}
                  placeholder="36500"
                  className="w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-zinc-400"
                />
              </div>
            </div>

            <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
              Nenhuma revisão deste deck será agendada para mais longe que isso. Deixe vazio para
              usar o padrão global (36500).
            </p>
          </div>

          {/* ── Daily Limits (estilo iOS, como no Anki) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <CalendarClock className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Limites Diários
              </label>
            </div>

            {/* iOS grouped inset list */}
            <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700/60 overflow-hidden">
              <div className="flex items-center justify-between px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Sparkle className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Novos cards/dia
                  </span>
                </div>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={newCardsPerDay}
                  onChange={(e) => setNewCardsPerDay(e.target.value)}
                  placeholder={String(StorageService.DEFAULT_DAILY_LIMITS.newCardsPerDay)}
                  className="w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-zinc-400"
                />
              </div>

              <div className="flex items-center justify-between px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Máx. revisões/dia
                  </span>
                </div>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={maxReviewsPerDay}
                  onChange={(e) => setMaxReviewsPerDay(e.target.value)}
                  placeholder={String(StorageService.DEFAULT_DAILY_LIMITS.maxReviewsPerDay)}
                  className="w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-zinc-400"
                />
              </div>
            </div>

            <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
              Deixe vazio para herdar o padrão ({StorageService.DEFAULT_DAILY_LIMITS.newCardsPerDay} novos ·{' '}
              {StorageService.DEFAULT_DAILY_LIMITS.maxReviewsPerDay} revisões). O limite vale para este deck
              e todos os subdecks — igual ao Anki. Use 0 para pausar novos cards/revisões hoje.
            </p>
          </div>

          {/* ── Novos Cards (Anki) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <GraduationCap className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Novos Cards
              </label>
            </div>

            <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700/60 overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                    <ListOrdered className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Passos de aprendizagem
                  </span>
                </div>
                <input
                  type="text"
                  value={learningSteps}
                  onChange={(e) => setLearningSteps(e.target.value)}
                  placeholder={StorageService.formatSteps(StorageService.DEFAULT_SCHEDULER.learningSteps)}
                  className="w-28 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-zinc-400"
                />
              </div>

              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                    <ArrowDownUp className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Ordem de inserção
                  </span>
                </div>
                {/* iOS segmented control */}
                <div className="flex rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-0.5">
                  {(
                    [
                      ['inherit', 'Padrão'],
                      ['sequential', 'Sequencial'],
                      ['random', 'Aleatório'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setInsertionOrder(value)}
                      className={`px-2.5 py-1 rounded-[10px] text-[11px] font-semibold transition-all ${
                        insertionOrder === value
                          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
              Passos aceitam formatos como "1m 10m", "30s 5m" ou "1h". "Sequencial" introduz os
              cards na ordem de criação; "Aleatório" embaralha — igual ao Anki.
            </p>
          </div>

          {/* ── Lapses (Anki) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Lapses (Cards Esquecidos)
              </label>
            </div>

            <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700/60 overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-orange-500/15 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Passos de reaprendizagem
                  </span>
                </div>
                <input
                  type="text"
                  value={relearningSteps}
                  onChange={(e) => setRelearningSteps(e.target.value)}
                  placeholder={StorageService.formatSteps(StorageService.DEFAULT_SCHEDULER.relearningSteps)}
                  className="w-28 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-zinc-400"
                />
              </div>

              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                    <BellRing className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Limite de leech
                  </span>
                </div>
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={leechThreshold}
                  onChange={(e) => setLeechThreshold(e.target.value)}
                  placeholder={String(StorageService.DEFAULT_SCHEDULER.leechThreshold)}
                  className="w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-zinc-400"
                />
              </div>

              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-red-500/15 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                    <Hand className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Ação de leech
                  </span>
                </div>
                <div className="flex rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-0.5">
                  {(
                    [
                      ['inherit', 'Padrão'],
                      ['suspend', 'Suspender'],
                      ['tag', 'Etiquetar'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setLeechAction(value)}
                      className={`px-2.5 py-1 rounded-[10px] text-[11px] font-semibold transition-all ${
                        leechAction === value
                          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
              Após o limite de lapsos, o card vira "leech": <strong>Suspender</strong> o remove das
              revisões; <strong>Etiquetar</strong> adiciona a tag "leech" na nota (visível no
              Navegador). Padrão do Anki: {StorageService.DEFAULT_SCHEDULER.leechThreshold} lapsos,
              suspender.
            </p>
          </div>

          {/* ── Áudio (Anki) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Volume2 className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Áudio
              </label>
            </div>

            <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700/60 overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Volume2 className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Reproduzir áudio automaticamente
                  </span>
                </div>
                <div className="flex rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 p-0.5">
                  {(
                    [
                      ['inherit', 'Padrão'],
                      ['play', 'Sim'],
                      ['dont', 'Não'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setAudioAutoplay(value)}
                      className={`px-2.5 py-1 rounded-[10px] text-[11px] font-semibold transition-all ${
                        audioAutoplay === value
                          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
              <strong>Sim</strong>: os áudios dos cards (<code>[sound:...]</code>,{' '}
              <code>&lt;audio autoplay&gt;</code>) tocam sozinhos ao mostrar a pergunta ou a
              resposta. <strong>Não</strong>: reproduzem apenas ao clicar no botão de play.
              "Padrão" herda do deck-pai (o padrão do Anki é reproduzir automaticamente).
            </p>
          </div>

          {/* ── Ordem de Exibição (Anki Display Order) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Ordem de Exibição
              </label>
            </div>

            <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-200 dark:divide-zinc-700/60 overflow-hidden">
              {[
                {
                  icon: <Layers className="w-3.5 h-3.5" />,
                  color: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
                  label: 'Coleta de novos cards',
                  value: newGatherOrder,
                  onChange: (v: string) => setNewGatherOrder(v as 'inherit' | NewGatherOrder),
                  options: [
                    ['inherit', 'Padrão (Deck)'],
                    ['deck', 'Deck'],
                    ['positionAsc', 'Posição crescente'],
                    ['positionDesc', 'Posição decrescente'],
                    ['random', 'Aleatório'],
                  ],
                },
                {
                  icon: <ArrowDownUp className="w-3.5 h-3.5" />,
                  color: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
                  label: 'Ordem dos novos cards',
                  value: newSortOrder,
                  onChange: (v: string) => setNewSortOrder(v as 'inherit' | NewSortOrder),
                  options: [
                    ['inherit', 'Padrão (Tipo de card)'],
                    ['template', 'Tipo de card, depois coletado'],
                    ['gathered', 'Ordem coletada'],
                    ['random', 'Aleatório'],
                  ],
                },
                {
                  icon: <Blend className="w-3.5 h-3.5" />,
                  color: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
                  label: 'Novos / Revisões',
                  value: newReviewOrder,
                  onChange: (v: string) => setNewReviewOrder(v as 'inherit' | MixOrder),
                  options: [
                    ['inherit', 'Padrão (Misturar)'],
                    ['mix', 'Misturar com revisões'],
                    ['after', 'Mostrar depois das revisões'],
                    ['before', 'Mostrar antes das revisões'],
                  ],
                },
                {
                  icon: <TimerReset className="w-3.5 h-3.5" />,
                  color: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400',
                  label: 'Aprendizado / Revisões',
                  value: learnReviewOrder,
                  onChange: (v: string) => setLearnReviewOrder(v as 'inherit' | MixOrder),
                  options: [
                    ['inherit', 'Padrão (Misturar)'],
                    ['mix', 'Misturar com revisões'],
                    ['after', 'Mostrar depois das revisões'],
                    ['before', 'Mostrar antes das revisões'],
                  ],
                },
                {
                  icon: <SortAsc className="w-3.5 h-3.5" />,
                  color: 'bg-lime-500/15 text-lime-600 dark:text-lime-400',
                  label: 'Ordem das revisões',
                  value: reviewSortOrder,
                  onChange: (v: string) => setReviewSortOrder(v as 'inherit' | ReviewSortOrder),
                  options: [
                    ['inherit', 'Padrão (Vencimento, depois aleatório)'],
                    ['dueRandom', 'Vencimento, depois aleatório'],
                    ['dueAsc', 'Vencimento crescente'],
                    ['dueDesc', 'Vencimento decrescente'],
                    ['intervalAsc', 'Intervalo crescente'],
                    ['intervalDesc', 'Intervalo decrescente'],
                    ['easeAsc', 'Facilidade crescente'],
                    ['easeDesc', 'Facilidade decrescente'],
                    ['random', 'Aleatório'],
                  ],
                },
              ].map(({ icon, color, label, value, onChange, options }) => (
                <div key={label} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-7 h-7 rounded-lg ${color} flex items-center justify-center shrink-0`}>
                      {icon}
                    </div>
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      {label}
                    </span>
                  </div>
                  <IOSSelect
                    value={value}
                    onChange={onChange}
                    options={options.map(([v, label]) => ({ value: v as string, label: label as string }))}
                    className="min-w-[190px]"
                  />
                </div>
              ))}
            </div>

            <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
              Controla a ordem da fila de estudo: coleta e ordenação de novos cards, mistura de
              aprendizado/novos com revisões e ordenação das revisões — igual ao Display Order do
              Anki. "Padrão" herda do deck-pai.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs shadow-md transition-all active:scale-95 disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Salvar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
