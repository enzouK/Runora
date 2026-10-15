import React, { useState, useEffect, useMemo, useCallback } from 'react';
import confetti from 'canvas-confetti';
import {
  ArrowLeft,
  Lightbulb,
  CheckCircle2,
  Sparkles,
  Info,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Volume2,
  AlertTriangle,
  Edit,
} from 'lucide-react';
import { Card, CardState, Deck, FSRSPrediction, FSRSRating, Note, NoteType } from '../../types/anki';
import { FSRS } from '../../fsrs/algorithm';
import { ClozeService } from '../../services/clozeService';
import { AudioService } from '../../services/audioService';
import { StorageService } from '../../services/storage';
import { RatingButtons } from './RatingButtons';
import { CardContentRenderer } from './CardContentRenderer';
import { CardEditorModal } from '../cards/CardEditorModal';

interface StudyViewProps {
  deck: Deck;
  onBack: () => void;
  onReviewFinished: () => void;
}

export const StudyView: React.FC<StudyViewProps> = ({
  deck,
  onBack,
  onReviewFinished,
}) => {
  const [cards, setCards] = useState<Card[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnswerRevealed, setIsAnswerRevealed] = useState(false);
  const [temporaryRecordingUrl, setTemporaryRecordingUrl] = useState<string | null>(null);
  const [showFSRSDetails, setShowFSRSDetails] = useState(false);
  const [sessionReviewedCount, setSessionReviewedCount] = useState(0);
  const [leechNotice, setLeechNotice] = useState<string | null>(null);
  const [editNoteId, setEditNoteId] = useState<string | null>(null);
  const [noteRefreshTick, setNoteRefreshTick] = useState(0);

  // Initialize FSRS engine with deck-specific or global settings
  const fsrsEngine = useMemo(() => {
    const globalParams = StorageService.getFSRSSettings();
    return new FSRS({ ...globalParams, ...(deck.fsrsParams || {}) });
  }, [deck]);

  // Anki-style scheduler config (learning steps, insertion order, lapses)
  const schedulerConfig = useMemo(
    () => StorageService.getEffectiveSchedulerConfig(deck.id),
    [deck]
  );

  // Anki-style Audio config ("Don't play audio automatically")
  const audioConfig = useMemo(
    () => StorageService.getEffectiveAudioConfig(deck.id),
    [deck]
  );

  // Load cards due for this deck (and subdecks)
  const loadDueCards = useCallback(() => {
    const allDecks = StorageService.getDecks();
    const prefix = `${deck.name}::`;
    const matchingDeckIds = new Set(
      allDecks
        .filter((d) => d.id === deck.id || d.name.startsWith(prefix))
        .map((d) => d.id)
    );

    const now = Date.now();
    const allCards = StorageService.getCards().filter((c) => !c.suspended);

    // Anki-style daily limits:
    // 1) The studied deck (and its ancestors) impose a SHARED pool across all subdecks
    // 2) Each subdeck additionally has its own budget (its limit minus today's usage)
    const pool = StorageService.getRemainingDailyLimits(deck.id, now);
    let poolNew = pool.newRemaining;
    let poolReview = pool.reviewRemaining;

    const subBudget = new Map<string, { newLeft: number; reviewLeft: number }>();
    for (const d of allDecks) {
      if (!matchingDeckIds.has(d.id) || d.id === deck.id) continue;
      const eff = StorageService.getEffectiveDailyLimits(d.id);
      const usage = StorageService.getDailyUsage(d.id, now);
      subBudget.set(d.id, {
        newLeft: Math.max(0, eff.newCardsPerDay - usage.newUsed),
        reviewLeft: Math.max(0, eff.maxReviewsPerDay - usage.reviewUsed),
      });
    }

    const dueList = allCards.filter((c) => {
      if (!matchingDeckIds.has(c.deckId)) return false;

      // Learning/relearning cards are always shown (Anki never hides them)
      if (c.fsrs.state === 1 || c.fsrs.state === 3) {
        return c.due <= now;
      }

      const sub = subBudget.get(c.deckId); // undefined for cards directly in the studied deck

      if (c.fsrs.state === 0) {
        if (poolNew <= 0 || (sub && sub.newLeft <= 0)) return false; // New cards daily limit reached
        poolNew--;
        if (sub) sub.newLeft--;
        return true;
      }

      // Review queue
      if (c.due > now) return false;
      if (poolReview <= 0 || (sub && sub.reviewLeft <= 0)) return false; // Max reviews/day reached
      poolReview--;
      if (sub) sub.reviewLeft--;
      return true;
    });

    // ---- Display Order (Anki) ----
    const displayOrder = StorageService.getEffectiveDisplayOrder(deck.id);
    const shuffle = <T,>(arr: T[]): T[] => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    };
    const combineByMixOrder = (primary: Card[], extra: Card[], order: string): Card[] => {
      if (order === 'before') return [...extra, ...primary];
      if (order === 'after') return [...primary, ...extra];
      return shuffle([...primary, ...extra]); // 'mix'
    };

    const learning = dueList
      .filter((c) => c.fsrs.state === 1 || c.fsrs.state === 3)
      .sort((a, b) => a.due - b.due);
    const reviews = dueList.filter((c) => c.fsrs.state === 2);
    const newCards = dueList.filter((c) => c.fsrs.state === 0);

    // 1) New card gather order
    switch (displayOrder.newGatherOrder) {
      case 'random':
        shuffle(newCards);
        break;
      case 'positionAsc':
        newCards.sort((a, b) => a.createdAt - b.createdAt);
        break;
      case 'positionDesc':
        newCards.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case 'deck':
      default:
        // Group by deck, then insertion order (sequential/random) within each deck
        newCards.sort((a, b) => {
          if (a.deckId !== b.deckId) return a.deckId < b.deckId ? -1 : 1;
          return schedulerConfig.insertionOrder === 'random'
            ? Math.random() - 0.5
            : a.createdAt - b.createdAt;
        });
        break;
    }

    // 2) New card sort order (after gathering)
    if (displayOrder.newSortOrder === 'random') {
      shuffle(newCards);
    } else if (displayOrder.newSortOrder === 'template') {
      newCards.sort((a, b) => a.templateOrd - b.templateOrd);
    }
    // 'gathered' → keep gather order

    // 3) Review sort order
    switch (displayOrder.reviewSortOrder) {
      case 'random':
        shuffle(reviews);
        break;
      case 'dueAsc':
        reviews.sort((a, b) => a.due - b.due);
        break;
      case 'dueDesc':
        reviews.sort((a, b) => b.due - a.due);
        break;
      case 'intervalAsc':
        reviews.sort((a, b) => a.fsrs.scheduledDays - b.fsrs.scheduledDays);
        break;
      case 'intervalDesc':
        reviews.sort((a, b) => b.fsrs.scheduledDays - a.fsrs.scheduledDays);
        break;
      case 'easeAsc': // lowest ease (highest difficulty) first
        reviews.sort((a, b) => b.fsrs.difficulty - a.fsrs.difficulty);
        break;
      case 'easeDesc': // highest ease first
        reviews.sort((a, b) => a.fsrs.difficulty - b.fsrs.difficulty);
        break;
      case 'dueRandom':
      default: {
        // Due date ascending, random within the same day (Anki default)
        const dayOf = (t: number) => Math.floor(t / 86400000);
        reviews.sort((a, b) => {
          const d = dayOf(a.due) - dayOf(b.due);
          return d !== 0 ? d : Math.random() - 0.5;
        });
        break;
      }
    }

    // 4) Interday learning/review order, then new/review order
    let queue = combineByMixOrder(reviews, learning, displayOrder.learnReviewOrder);
    queue = combineByMixOrder(queue, newCards, displayOrder.newReviewOrder);

    setCards(queue);
    setCurrentIndex(0);
    setIsAnswerRevealed(false);
    setTemporaryRecordingUrl(null);
  }, [deck, schedulerConfig]);

  useEffect(() => {
    loadDueCards();
    return () => {
      AudioService.cleanupCurrentRecording();
    };
  }, [loadDueCards]);

  const currentCard = cards[currentIndex] || null;

  // Retrieve Note and NoteType
  const noteData = useMemo(() => {
    if (!currentCard) return null;
    const notes = StorageService.getNotes();
    const noteTypes = StorageService.getNoteTypes();
    const note = notes.find((n) => n.id === currentCard.noteId);
    if (!note) return null;
    const noteType = noteTypes.find((nt) => nt.id === note.noteTypeId);
    return { note, noteType };
  }, [currentCard, noteRefreshTick]); // noteRefreshTick força recarregamento após edição

  // Clean temporary recording on card change
  useEffect(() => {
    setIsAnswerRevealed(false);
    setTemporaryRecordingUrl(null);
    AudioService.cleanupCurrentRecording();
  }, [currentIndex]);

  /**
   * Step-aware interval for a rating (minutes), or null when the FSRS result applies.
   * Mirrors Anki: Again → first step, Hard → repeat current step, Good → next step
   * (graduating past the last step), Easy → always graduates.
   */
  const stepOverrideMinutes = useCallback(
    (card: Card, rating: FSRSRating): number | null => {
      if (rating === 4) return null; // Easy always graduates → FSRS interval

      const state = card.fsrs.state;
      const steps =
        state === 3 ? schedulerConfig.relearningSteps : schedulerConfig.learningSteps;
      const idx = card.learningStep ?? 0;

      if (state === 2) {
        return rating === 1 ? schedulerConfig.relearningSteps[0] : null;
      }
      if (rating === 1) return steps[0];                      // Again → first step
      if (rating === 2) return steps[Math.min(idx, steps.length - 1)]; // Hard → repeat step
      // rating === 3 (Good)
      if (state === 0) {
        return steps.length > 1 ? steps[1] : null; // new card: advance to step 2 or graduate
      }
      return idx + 1 < steps.length ? steps[idx + 1] : null;
    },
    [schedulerConfig]
  );

  // Calculate FSRS predictions for the 4 buttons (with learning-step labels)
  const predictions = useMemo<Record<FSRSRating, FSRSPrediction> | null>(() => {
    if (!currentCard) return null;
    const base = fsrsEngine.predictRatings(currentCard.fsrs);
    ([1, 2, 3, 4] as FSRSRating[]).forEach((r) => {
      const stepMin = stepOverrideMinutes(currentCard, r);
      if (stepMin !== null) {
        base[r] = {
          ...base[r],
          intervalDays: stepMin / 1440,
          intervalText: StorageService.formatSteps([stepMin]),
        };
      }
    });
    return base;
  }, [currentCard, fsrsEngine, stepOverrideMinutes]);

  // Render Front HTML
  const frontHtml = useMemo(() => {
    if (!noteData || !currentCard) return '';
    const { note, noteType } = noteData;
    if (!noteType) return '';

    if (noteType.isCloze) {
      const textField = note.fields['Texto'] || Object.values(note.fields)[0] || '';
      return ClozeService.formatMediaContent(ClozeService.renderClozeFront(textField, currentCard.templateOrd));
    }

    const template = noteType.templates[currentCard.templateOrd] || noteType.templates[0];
    if (!template) return '';

    return ClozeService.renderTemplate(template.qfmt, note.fields, false, undefined, currentCard.templateOrd);
  }, [noteData, currentCard]);

  // Render Back HTML
  const backHtml = useMemo(() => {
    if (!noteData || !currentCard) return '';
    const { note, noteType } = noteData;
    if (!noteType) return '';

    if (noteType.isCloze) {
      const textField = note.fields['Texto'] || Object.values(note.fields)[0] || '';
      const extraField = note.fields['Extra'] || '';
      const renderedCloze = ClozeService.formatMediaContent(ClozeService.renderClozeBack(textField, currentCard.templateOrd));
      const formattedExtra = ClozeService.formatMediaContent(extraField);
      return `<div>${renderedCloze}</div>${
        extraField ? `<hr class="my-4 border-black/10 dark:border-white/10" /><div class="text-sm opacity-85">${formattedExtra}</div>` : ''
      }`;
    }

    const template = noteType.templates[currentCard.templateOrd] || noteType.templates[0];
    if (!template) return '';

    const out = ClozeService.renderTemplate(template.afmt, note.fields, true, frontHtml, currentCard.templateOrd);
    return out;
  }, [noteData, currentCard, frontHtml]);

  // Handle revealing answer
  const handleRevealAnswer = () => {
    setIsAnswerRevealed(true);
    AudioService.playHapticTone('flip');
  };

  // Handle rating with FSRS
  const handleRate = (rating: FSRSRating) => {
    if (!currentCard || !predictions) return;

    // Haptic sound
    if (rating === 1) AudioService.playHapticTone('again');
    else if (rating === 4) AudioService.playHapticTone('easy');
    else AudioService.playHapticTone('good');

    // applyFuzz=true: real scheduling uses Anki's interval fuzz to avoid card bunching
    const fsrsNext = fsrsEngine.step(currentCard.fsrs, rating, undefined, undefined, true);
    const now = Date.now();
    const state = currentCard.fsrs.state;
    const minToMs = (m: number) => Math.round(m * 60 * 1000);
    const learnState: CardState = state === 3 ? 3 : 1;

    let nextCardData = fsrsNext;
    let learningStep: number | undefined;
    let nextDueMs = now + Math.round(fsrsNext.scheduledDays * 24 * 60 * 60 * 1000);

    if (state === 2 && rating === 1) {
      // Lapse: Review + Again → first relearning step (Anki behavior)
      const step0 = schedulerConfig.relearningSteps[0];
      nextCardData = { ...fsrsNext, state: 3, scheduledDays: step0 / 1440 };
      learningStep = 0;
      nextDueMs = now + minToMs(step0);
    } else if ((state === 0 || state === 1 || state === 3) && rating !== 4) {
      const steps =
        state === 3 ? schedulerConfig.relearningSteps : schedulerConfig.learningSteps;
      const idx = currentCard.learningStep ?? 0;

      if (rating === 3) {
        // Good → advance to the next step; graduate past the last one
        const nextIdx = state === 0 ? 1 : idx + 1;
        if (nextIdx < steps.length) {
          nextCardData = { ...fsrsNext, state: learnState, scheduledDays: steps[nextIdx] / 1440 };
          learningStep = nextIdx;
          nextDueMs = now + minToMs(steps[nextIdx]);
        }
        // else: graduates — add fsrsNext as-is (already Review state)
      } else {
        // Again → first step; Hard → repeat current step
        const targetIdx = rating === 1 ? 0 : Math.min(idx, steps.length - 1);
        nextCardData = {
          ...fsrsNext,
          state: learnState,
          scheduledDays: steps[targetIdx] / 1440,
        };
        learningStep = targetIdx;
        nextDueMs = now + minToMs(steps[targetIdx]);
      }
    }
    // rating 4 (Easy) or successful Review → fsrsNext as-is (Review state, FSRS interval)

    // Leech detection: review card lapsed enough times
    const hitLeech =
      state === 2 && rating === 1 &&
      !currentCard.suspended &&
      nextCardData.lapses >= schedulerConfig.leechThreshold;

    const updatedCard: Card = {
      ...currentCard,
      due: nextDueMs,
      fsrs: nextCardData,
      learningStep,
      suspended: hitLeech && schedulerConfig.leechAction === 'suspend' ? true : currentCard.suspended,
      updatedAt: now,
    };

    // Update in Storage
    const allCards = StorageService.getCards();
    const updatedCardsList = allCards.map((c) => (c.id === updatedCard.id ? updatedCard : c));
    StorageService.saveCards(updatedCardsList);

    // Leech action (Anki): suspend the card, or just tag the note
    if (hitLeech) {
      if (schedulerConfig.leechAction === 'suspend') {
        setLeechNotice(`Leech: card suspenso após ${nextCardData.lapses} lapsos`);
      } else {
        const notes = StorageService.getNotes().map((n) =>
          n.id === currentCard.noteId && !n.tags.includes('leech')
            ? { ...n, tags: [...n.tags, 'leech'], updatedAt: Date.now() }
            : n
        );
        StorageService.saveNotes(notes);
        setLeechNotice(`Leech: nota marcada com a etiqueta "leech" (${nextCardData.lapses} lapsos)`);
      }
      window.setTimeout(() => setLeechNotice(null), 5000);
    }

    // Save revlog
    StorageService.saveRevlog({
      id: `rev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      cardId: currentCard.id,
      noteId: currentCard.noteId,
      rating,
      reviewTime: now,
      elapsedDays: nextCardData.elapsedDays,
      scheduledDays: nextCardData.scheduledDays,
      state: currentCard.fsrs.state,
      stability: nextCardData.stability,
      difficulty: nextCardData.difficulty,
    });

    setSessionReviewedCount((c) => c + 1);

    // Keep learning/relearning cards coming back within the session
    // (Anki learn-ahead limit: 20 min — previously we used 10)
    const stillLearning = updatedCard.fsrs.state === 1 || updatedCard.fsrs.state === 3;
    const dueSoon = updatedCard.due - now <= 20 * 60 * 1000;
    if (stillLearning && dueSoon && !updatedCard.suspended) {
      const remainingCards = [...cards];
      remainingCards.splice(currentIndex, 1);
      remainingCards.push(updatedCard);
      setCards(remainingCards);
    } else {
      // Remove from current study session (graduated, scheduled in days, or suspended)
      const remainingCards = [...cards];
      remainingCards.splice(currentIndex, 1);
      setCards(remainingCards);
    }

    setIsAnswerRevealed(false);
    setTemporaryRecordingUrl(null);
    AudioService.cleanupCurrentRecording();

    // Check if deck finished
    const willRequeue = stillLearning && dueSoon && !updatedCard.suspended;
    if (cards.length <= 1 && !willRequeue) {
      try {
        confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#007AFF', '#34C759', '#FF9500', '#5856D6'],
        });
      } catch {
        // ignore
      }
      AudioService.playHapticTone('success');
    }
  };

  // Keyboard shortcut listener (Space to reveal, 1-4 to rate)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (!isAnswerRevealed) {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          handleRevealAnswer();
        }
      } else {
        if (e.key === '1') {
          e.preventDefault();
          handleRate(1);
        } else if (e.key === '2') {
          e.preventDefault();
          handleRate(2);
        } else if (e.key === '3') {
          e.preventDefault();
          handleRate(3);
        } else if (e.key === '4') {
          e.preventDefault();
          handleRate(4);
        } else if (e.code === 'Space') {
          e.preventDefault();
          // Space on back defaults to Good (3)
          handleRate(3);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAnswerRevealed, cards, currentIndex]);

  // Deck finished view
  if (!currentCard || cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] p-6 text-center animate-in fade-in duration-300">
        <div className="w-20 h-20 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-6 shadow-sm">
          <CheckCircle2 className="w-10 h-10 stroke-[2.2]" />
        </div>

        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 mb-2">
          Parabéns! Revisão Concluída
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm mb-6">
          Você revisou todas as cartas programadas para hoje no deck <span className="font-semibold text-zinc-700 dark:text-zinc-300">"{deck.name}"</span>. O algoritmo FSRS recalculou a estabilidade e os novos intervalos.
        </p>

        <div className="flex items-center gap-4 p-4 rounded-2xl bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 mb-8 text-left text-xs">
          <div>
            <div className="text-zinc-400 dark:text-zinc-500 font-medium">Revisados nesta sessão</div>
            <div className="text-lg font-bold text-zinc-800 dark:text-zinc-100">{sessionReviewedCount} cards</div>
          </div>
          <div className="h-8 w-px bg-zinc-300 dark:bg-zinc-700" />
          <div>
            <div className="text-zinc-400 dark:text-zinc-500 font-medium">Retenção FSRS</div>
            <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
              {Math.round(fsrsEngine.getParameters().requestRetention * 100)}%
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="px-5 py-2.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm transition-all shadow-md active:scale-95"
          >
            Voltar aos Decks
          </button>
          <button
            type="button"
            onClick={() => {
              loadDueCards();
              setSessionReviewedCount(0);
            }}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-medium text-sm transition-all active:scale-95"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Recarregar</span>
          </button>
        </div>
      </div>
    );
  }

  const { noteType } = noteData || {};
  const isVoiceConfigured = noteType?.voiceRecordingEnabled ?? false;

  return (
    <div className="max-w-2xl mx-auto px-4 py-3 flex flex-col min-h-[calc(100vh-80px)]">
      {/* Top Header bar */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors py-1 px-2 -ml-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Decks</span>
        </button>

        <div className="flex items-center gap-2">
          <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 truncate max-w-[200px]">
            {deck.name}
          </div>
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[11px] font-mono">
            <span className="text-blue-600 dark:text-blue-400 font-bold">{cards.length}</span>
            <span className="text-zinc-400">restantes</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowFSRSDetails((prev) => !prev)}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title="Ver Parâmetros FSRS do Card"
        >
          <Info className="w-4 h-4" />
        </button>
      </div>

      {/* FSRS Live Inspector Popup / Panel */}
      {showFSRSDetails && (
        <div className="mb-4 p-3.5 rounded-2xl bg-zinc-100/90 dark:bg-zinc-800/80 border border-zinc-200/80 dark:border-zinc-700/80 text-xs backdrop-blur-sm animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-500" />
              Parâmetros FSRS em Tempo Real
            </span>
            <span className="font-mono text-[10px] text-zinc-400">
              Estado: {currentCard.fsrs.state === 0 ? 'Novo' : currentCard.fsrs.state === 1 ? 'Aprendizado' : currentCard.fsrs.state === 2 ? 'Revisão' : 'Reaprendizado'}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center font-mono text-[11px]">
            <div className="p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <div className="text-zinc-400 text-[10px]">Estabilidade (S)</div>
              <div className="font-bold text-blue-600 dark:text-blue-400">{currentCard.fsrs.stability.toFixed(2)}d</div>
            </div>
            <div className="p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <div className="text-zinc-400 text-[10px]">Dificuldade (D)</div>
              <div className="font-bold text-amber-600 dark:text-amber-400">{currentCard.fsrs.difficulty.toFixed(2)}/10</div>
            </div>
            <div className="p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <div className="text-zinc-400 text-[10px]">Repetições</div>
              <div className="font-bold text-zinc-700 dark:text-zinc-300">{currentCard.fsrs.reps}</div>
            </div>
            <div className="p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
              <div className="text-zinc-400 text-[10px]">Lapses (Erros)</div>
              <div className="font-bold text-rose-600 dark:text-rose-400">{currentCard.fsrs.lapses}</div>
            </div>
          </div>
        </div>
      )}

      {/* Main Flashcard Container (Apple Inset Frosted Card) */}
      <div className="flex-1 flex flex-col justify-between p-6 sm:p-8 rounded-3xl bg-white/95 dark:bg-zinc-900/90 border border-zinc-200/90 dark:border-zinc-800/90 shadow-xl shadow-black/5 backdrop-blur-xl relative overflow-hidden transition-all duration-200 min-h-[380px]">
        {/* Dynamic NoteType Custom CSS */}
        {noteType?.css && (
          <style dangerouslySetInnerHTML={{ __html: noteType.css }} />
        )}

        {/* Edit button (like Anki's Edit during review) */}
        {currentCard && (
          <button
            type="button"
            onClick={() => currentCard && setEditNoteId(currentCard.noteId)}
            className="absolute top-3.5 right-3.5 z-40 p-2.5 rounded-xl bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border border-zinc-200/80 dark:border-zinc-700/80 text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-300 transition-all active:scale-95 shadow-sm"
            title="Editar este card (Anki: tecla E)"
          >
            <Edit className="w-4 h-4" />
          </button>
        )}

        {/* Card Content Area (Frente quando !isAnswerRevealed, Verso quando isAnswerRevealed) */}
        <div className="flex-1">
          {!isAnswerRevealed ? (
            <div className="anki-front-wrapper prose prose-zinc dark:prose-invert max-w-none text-zinc-900 dark:text-zinc-100 font-sans leading-relaxed">
              <CardContentRenderer
                key={`front-${currentCard.id}`}
                html={frontHtml}
                recordedAudioUrl={temporaryRecordingUrl}
                onRecordingComplete={(url) => setTemporaryRecordingUrl(url)}
                cardId={currentCard.id}
                disableAutoplay={audioConfig.disableAutoplay}
              />
            </div>
          ) : (
            <div className="anki-back-wrapper prose prose-zinc dark:prose-invert max-w-none text-zinc-900 dark:text-zinc-100 font-sans leading-relaxed animate-in fade-in duration-200">
              <CardContentRenderer
                key={`back-${currentCard.id}`}
                html={backHtml}
                recordedAudioUrl={temporaryRecordingUrl}
                onRecordingComplete={(url) => setTemporaryRecordingUrl(url)}
                cardId={currentCard.id}
                disableAutoplay={audioConfig.disableAutoplay}
              />
            </div>
          )}
        </div>

        {/* Bottom Actions Bar */}
        <div className="mt-8 pt-4">
          {!isAnswerRevealed ? (
            <button
              type="button"
              onClick={handleRevealAnswer}
              className="w-full py-3.5 px-6 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-base shadow-lg shadow-blue-500/20 transition-all active:scale-[0.99] flex items-center justify-center gap-2"
            >
              <span>Mostrar Resposta</span>
              <span className="hidden sm:inline-block px-1.5 py-0.5 rounded text-[11px] font-mono bg-white/20">
                Espaço
              </span>
            </button>
          ) : (
            <RatingButtons
              predictions={predictions}
              onRate={handleRate}
            />
          )}
        </div>
      </div>

      {/* Leech notice toast */}
      {leechNotice && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full bg-amber-500 text-white text-xs font-semibold shadow-xl shadow-amber-500/30 animate-in fade-in slide-in-from-bottom-3 duration-300">
          <AlertTriangle className="w-4 h-4" />
          <span>{leechNotice}</span>
        </div>
      )}

      {/* Editar card durante a revisão (como o Anki: botão "Editar Nota") */}
      <CardEditorModal
        isOpen={editNoteId !== null}
        onClose={() => setEditNoteId(null)}
        onSaved={() => {
          setEditNoteId(null);
          setNoteRefreshTick((t) => t + 1); // recarrega os campos desta nota na revisão
          onReviewFinished();
        }}
        editNoteId={editNoteId}
      />
    </div>
  );
};
