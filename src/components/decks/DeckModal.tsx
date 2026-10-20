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
  InsertionOrder,
  LeechAction,
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
  const [maxInterval, setMaxInterval] = useState('36500');
  const [newCardsPerDay, setNewCardsPerDay] = useState('20');
  const [maxReviewsPerDay, setMaxReviewsPerDay] = useState('200');
  // Scheduler options — always show the REAL effective values (no 'Padrão' pseudo-option)
  const [learningSteps, setLearningSteps] = useState('1m 10m');
  const [insertionOrder, setInsertionOrder] = useState<InsertionOrder>('sequential');
  const [relearningSteps, setRelearningSteps] = useState('10m');
  const [leechThreshold, setLeechThreshold] = useState('8');
  const [leechAction, setLeechAction] = useState<LeechAction>('suspend');
  const [newGatherOrder, setNewGatherOrder] = useState<NewGatherOrder>('deck');
  const [newSortOrder, setNewSortOrder] = useState<NewSortOrder>('template');
  const [newReviewOrder, setNewReviewOrder] = useState<MixOrder>('mix');
  const [learnReviewOrder, setLearnReviewOrder] = useState<MixOrder>('mix');
  const [reviewSortOrder, setReviewSortOrder] = useState<ReviewSortOrder>('dueRandom');
  const [audioAutoplay, setAudioAutoplay] = useState<'play' | 'dont'>('play');

  useEffect(() => {
    if (!isOpen) return;
    const decks = StorageService.getDecks();

    // Effective (resolved) values: the deck's own settings where set,
    // otherwise inherited from the parent lineage or the global defaults.
    const baseId = editDeck
      ? editDeck.id
      : parentDeckName
        ? decks.find((d) => d.name === parentDeckName)?.id
        : undefined;

    const effDaily = baseId
      ? StorageService.getEffectiveDailyLimits(baseId)
      : {
          newCardsPerDay: StorageService.DEFAULT_DAILY_LIMITS.newCardsPerDay,
          maxReviewsPerDay: StorageService.DEFAULT_DAILY_LIMITS.maxReviewsPerDay,
        };
    const effSched = baseId
      ? StorageService.getEffectiveSchedulerConfig(baseId)
      : {
          learningSteps: StorageService.DEFAULT_SCHEDULER.learningSteps,
          insertionOrder: StorageService.DEFAULT_SCHEDULER.insertionOrder,
          relearningSteps: StorageService.DEFAULT_SCHEDULER.relearningSteps,
          leechThreshold: StorageService.DEFAULT_SCHEDULER.leechThreshold,
          leechAction: StorageService.DEFAULT_SCHEDULER.leechAction,
        };
    const effOrder = baseId
      ? StorageService.getEffectiveDisplayOrder(baseId)
      : { ...StorageService.DEFAULT_DISPLAY_ORDER };
    const effAudio = baseId
      ? StorageService.getEffectiveAudioConfig(baseId)
      : { disableAutoplay: false };

    if (editDeck) {
      setName(editDeck.name);
      setDescription(editDeck.description);
    } else if (parentDeckName) {
      setName(`${parentDeckName}::`);
      setDescription('');
    } else {
      setName('');
      setDescription('');
    }

    setTargetRetention(editDeck?.fsrsParams?.requestRetention ?? 0.90);
    setMaxInterval(
      String(
        editDeck?.fsrsParams?.maximumInterval ??
          StorageService.getFSRSSettings().maximumInterval
      )
    );
    setNewCardsPerDay(String(effDaily.newCardsPerDay));
    setMaxReviewsPerDay(String(effDaily.maxReviewsPerDay));
    setLearningSteps(StorageService.formatSteps(effSched.learningSteps));
    setInsertionOrder(effSched.insertionOrder);
    setRelearningSteps(StorageService.formatSteps(effSched.relearningSteps));
    setLeechThreshold(String(effSched.leechThreshold));
    setLeechAction(effSched.leechAction);
    setNewGatherOrder(effOrder.newGatherOrder);
    setNewSortOrder(effOrder.newSortOrder);
    setNewReviewOrder(effOrder.newReviewOrder);
    setLearnReviewOrder(effOrder.learnReviewOrder);
    setReviewSortOrder(effOrder.reviewSortOrder);
    setAudioAutoplay(effAudio.disableAutoplay ? 'dont' : 'play');
  }, [isOpen, editDeck, parentDeckName]);

  const parseLimit = (value: string): number | null => {
    if (value.trim() === '') return null; // cleared → inherit from the deck parent
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
      insertionOrder,
      relearningSteps: relearningSteps.trim() || null,
      leechThreshold: parseLimit(leechThreshold),
      leechAction,
    };
    const displayOrder: DisplayOrderConfig = {
      newGatherOrder,
      newSortOrder,
      newReviewOrder,
      learnReviewOrder,
      reviewSortOrder,
    };
    const audioConfig = {
      disableAutoplay: audioAutoplay === 'dont',
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
        fsrsParams,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md bg-white dark:bg-ios-card-dark rounded-[20px] border border-black/[0.04] dark:border-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.2)] overflow-hidden flex flex-col max-h-[88vh] ios-fade-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.05] dark:border-white/[0.07]">
          <h3 className="text-[17px] font-bold text-zinc-900 dark:text-zinc-50">
            {editDeck ? 'Editar Deck' : 'Criar Novo Deck'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1.5">
              Nome do Deck
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: Idiomas::Inglês::Vocabulário"
              className="w-full px-3.5 py-2.5 rounded-[12px] bg-black/[0.05] dark:bg-white/[0.09] border border-transparent focus:border-ios-blue focus:outline-none text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400"
            />
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">
              Dica: Use "::" para criar subdecks hierárquicos (ex: Biologia::Celular).
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-1.5">
              Descrição
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Objetivo de estudo deste deck..."
              className="w-full px-3.5 py-2.5 rounded-[12px] bg-black/[0.05] dark:bg-white/[0.09] border border-transparent focus:border-ios-blue focus:outline-none text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 resize-none"
            />
          </div>

          {/* ── FSRS (retenção desejada por deck) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Sparkle className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                FSRS
              </label>
            </div>

            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] overflow-hidden">
              <div className="px-3.5 py-3">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                      <Sparkle className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      Retenção desejada
                    </span>
                  </div>
                  <span className="text-sm font-mono font-bold tabular-nums text-blue-600 dark:text-blue-400">
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
                <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                  <span>70% (Menos revisões)</span>
                  <span>90% (Padrão)</span>
                  <span>98% (Alta retenção)</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Intervalo Máximo (FSRS por deck; vazio = global) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Hourglass className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Intervalo Máximo
              </label>
            </div>

            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] overflow-hidden">
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
                  className="w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Limites Diários
              </label>
            </div>

            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] divide-y divide-black/[0.05] dark:divide-white/[0.06] overflow-hidden">
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
                  className="w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
              O limite vale para este deck e todos os subdecks — igual ao Anki. Use 0 para pausar
              novos cards/revisões hoje; limpe o campo para herdar do deck-pai.
            </p>
          </div>

          {/* ── Novos Cards (Anki) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <GraduationCap className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Novos Cards
              </label>
            </div>

            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] divide-y divide-black/[0.05] dark:divide-white/[0.06] overflow-hidden">
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
                  className="w-28 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <div className="flex rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] p-0.5">
                  {(
                    [
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
                          ? 'bg-ios-blue text-white shadow-[0_1px_4px_rgba(0,122,255,0.35)]'
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
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Lapses (Cards Esquecidos)
              </label>
            </div>

            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] divide-y divide-black/[0.05] dark:divide-white/[0.06] overflow-hidden">
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
                  className="w-28 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  className="w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] text-sm text-right font-mono text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <div className="flex rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] p-0.5">
                  {(
                    [
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
                          ? 'bg-ios-blue text-white shadow-[0_1px_4px_rgba(0,122,255,0.35)]'
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
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Áudio
              </label>
            </div>

            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] divide-y divide-black/[0.05] dark:divide-white/[0.06] overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <Volume2 className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                    Reproduzir áudio automaticamente
                  </span>
                </div>
                <div className="flex rounded-xl bg-white dark:bg-zinc-900 border border-black/[0.06] dark:border-white/[0.08] p-0.5">
                  {(
                    [
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
                          ? 'bg-ios-blue text-white shadow-[0_1px_4px_rgba(0,122,255,0.35)]'
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
              <code>{'<audio autoplay>'}</code>) tocam sozinhos ao mostrar a pergunta ou a
              resposta. <strong>Não</strong>: reproduzem apenas ao clicar no botão de play.
            </p>
          </div>

          {/* ── Ordem de Exibição (Anki Display Order) ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 text-zinc-400" />
              <label className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Ordem de Exibição
              </label>
            </div>

            <div className="rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.04] dark:border-white/[0.06] divide-y divide-black/[0.05] dark:divide-white/[0.06] overflow-hidden">
              {[
                {
                  icon: <Layers className="w-3.5 h-3.5" />,
                  color: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
                  label: 'Coleta de novos cards',
                  value: newGatherOrder,
                  onChange: (v: string) => setNewGatherOrder(v as NewGatherOrder),
                  options: [
                    ['deck', 'Deck'],
                    ['deckThenRandomNotes', 'Deck, depois notas aleatórias'],
                    ['positionAsc', 'Posição crescente'],
                    ['positionDesc', 'Posição decrescente'],
                    ['randomNotes', 'Notas aleatórias'],
                    ['random', 'Cards aleatórios'],
                  ],
                },
                {
                  icon: <ArrowDownUp className="w-3.5 h-3.5" />,
                  color: 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400',
                  label: 'Ordem dos novos cards',
                  value: newSortOrder,
                  onChange: (v: string) => setNewSortOrder(v as NewSortOrder),
                  options: [
                    ['template', 'Tipo de card, depois coletado'],
                    ['gathered', 'Ordem coletada'],
                    ['templateRandom', 'Tipo de card, depois aleatório'],
                    ['noteThenCardType', 'Nota aleatória, depois tipo de card'],
                    ['random', 'Aleatório'],
                  ],
                },
                {
                  icon: <Blend className="w-3.5 h-3.5" />,
                  color: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
                  label: 'Novos / Revisões',
                  value: newReviewOrder,
                  onChange: (v: string) => setNewReviewOrder(v as MixOrder),
                  options: [
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
                  onChange: (v: string) => setLearnReviewOrder(v as MixOrder),
                  options: [
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
                  onChange: (v: string) => setReviewSortOrder(v as ReviewSortOrder),
                  options: [
                    ['dueRandom', 'Vencimento, depois aleatório'],
                    ['dueAsc', 'Vencimento crescente'],
                    ['dueDesc', 'Vencimento decrescente'],
                    ['dueDeck', 'Vencimento, depois deck'],
                    ['deckThenDue', 'Deck, depois vencimento'],
                    ['intervalAsc', 'Intervalo crescente'],
                    ['intervalDesc', 'Intervalo decrescente'],
                    ['easeAsc', 'Facilidade crescente'],
                    ['easeDesc', 'Facilidade decrescente'],
                    ['retrievabilityAsc', 'Retrievabilidade crescente'],
                    ['random', 'Aleatório'],
                  ],
                },
              ].map(({ icon, color, label, value, onChange, options }) => (
                <div key={label} className="px-3.5 py-2.5 space-y-2">
                  <div className="flex items-center gap-2.5">
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
                    options={options.map(([v, l]) => ({ value: v as string, label: l as string }))}
                    className="w-full"
                  />
                </div>
              ))}
            </div>

            <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
              Controla a ordem da fila de estudo: coleta e ordenação de novos cards, mistura de
              aprendizado/novos com revisões e ordenação das revisões — igual ao Display Order do
              Anki.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-black/[0.05] dark:border-white/[0.07]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-full text-[13px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-ios-blue hover:bg-[#0071eb] text-white font-semibold text-[13px] shadow-[0_2px_8px_rgba(0,122,255,0.35)] transition-all active:scale-95 disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Salvar</span>
          </button>
        </div>
      </div>
    </div>
  );
};
