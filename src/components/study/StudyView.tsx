import React, { useState, useEffect, useMemo, useCallback } from 'react';
import confetti from 'canvas-confetti';
import {
  ChevronLeft,
  CheckCircle2,
  Sparkles,
  Info,
  RotateCcw,
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
    // FSRS: preset sheet first, then "This deck" overrides (retention + max interval)
    return new FSRS({
      ...globalParams,
      ...StorageService.getDeckPreset(deck.id).fsrsParams,
      ...(deck.fsrsOverride || {}),
    });
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
    const dayOf = (t: number) => Math.floor(t / 86400000);
    const today = dayOf(now);
    const allCards = StorageService.getCards().filter((c) => !c.suspended);

    // Anki-style daily limits:
    // 1) The studied deck (and its ancestors) impose a SHARED pool across all subdecks
    // 2) Each subdeck additionally has its own budget (its limit minus today's usage)
    // 3) The review limit is applied first to interday learning cards (i.e. (re)learning
    //    cards that cross the day boundary), then to the remaining review cards
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

    const subOf = (c: Card) => subBudget.get(c.deckId); // undefined for cards directly in the studied deck
    const admitReviewBudget = (c: Card): boolean => {
      const sub = subOf(c);
      if (poolReview <= 0 || (sub && sub.reviewLeft <= 0)) return false; // Max reviews/day reached
      poolReview--;
      if (sub) sub.reviewLeft--;
      return true;
    };
    const admitNewBudget = (c: Card): boolean => {
      const sub = subOf(c);
      if (poolNew <= 0 || (sub && sub.newLeft <= 0)) return false; // New cards daily limit reached
      poolNew--;
      if (sub) sub.newLeft--;
      return true;
    };
    const isOfDeck = (c: Card): boolean => matchingDeckIds.has(c.deckId);

    // (Re)learning cards due later today are intraday and are never hidden;
    // due on a later day = interday learning → consumes the review limit first (Anki)
    const intraLearning = allCards.filter(
      (c) =>
        isOfDeck(c) &&
        (c.fsrs.state === 1 || c.fsrs.state === 3) &&
        c.due <= now &&
        dayOf(c.due) === today
    );
    const interLearning = allCards.filter(
      (c) =>
        isOfDeck(c) &&
        (c.fsrs.state === 1 || c.fsrs.state === 3) &&
        c.due <= now &&
        dayOf(c.due) > today
    );
    const reviewDue = allCards.filter(
      (c) => isOfDeck(c) && c.fsrs.state === 2 && c.due <= now
    );

    const dueList = [
      ...intraLearning,
      ...interLearning.filter(admitReviewBudget),
      ...reviewDue.filter(admitReviewBudget),
      ...allCards.filter((c) => isOfDeck(c) && c.fsrs.state === 0).filter(admitNewBudget),
    ];

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
    const deckNameOf = (deckId: string): string =>
      allDecks.find((d) => d.id === deckId)?.name ?? '';
    // Anki "due #": fixed position for new cards; falls back to creation
    // order for cards that never had a position assigned
    const positionOf = (c: Card): number => c.position ?? c.createdAt;

    const learning = dueList
      .filter((c) => c.fsrs.state === 1 || c.fsrs.state === 3)
      .sort((a, b) => a.due - b.due);
    const reviews = dueList.filter((c) => c.fsrs.state === 2);
    let newCards = dueList.filter((c) => c.fsrs.state === 0);

    // 1) New card gather order
    switch (displayOrder.newGatherOrder) {
      case 'random':
        shuffle(newCards);
        break;
      case 'deckThenRandomNotes': {
        // Anki: "Deck, then random notes" — decks in order, notes shuffled inside
        const deckIds = [...new Set(newCards.map((c) => c.deckId))].sort();
        const out: Card[] = [];
        for (const deckId of deckIds) {
          const inDeck = newCards.filter((c) => c.deckId === deckId);
          const noteIds = [...new Set(inDeck.map((c) => c.noteId))];
          shuffle(noteIds);
          for (const noteId of noteIds) {
            out.push(
              ...inDeck
                .filter((c) => c.noteId === noteId)
                .sort((a, b) => a.templateOrd - b.templateOrd)
            );
          }
        }
        newCards = out;
        break;
      }
      case 'randomNotes': {
        // Anki: "Random notes" — notes picked at random, their cards kept together
        const noteIds = [...new Set(newCards.map((c) => c.noteId))];
        shuffle(noteIds);
        const out: Card[] = [];
        for (const noteId of noteIds) {
          out.push(
            ...newCards
              .filter((c) => c.noteId === noteId)
              .sort((a, b) => a.templateOrd - b.templateOrd)
          );
        }
        newCards = out;
        break;
      }
      case 'positionAsc':
        newCards.sort((a, b) => positionOf(a) - positionOf(b));
        break;
      case 'positionDesc':
        newCards.sort((a, b) => positionOf(b) - positionOf(a));
        break;
      case 'deck':
      default:
        // Group by deck, then by "due #" (position) within each deck — randomness
        // comes from the positions assigned once, fixed between sessions
        newCards.sort((a, b) => {
          if (a.deckId !== b.deckId) return a.deckId < b.deckId ? -1 : 1;
          return positionOf(a) - positionOf(b);
        });
        break;
    }

    // 2) New card sort order (after gathering)
    if (displayOrder.newSortOrder === 'random') {
      shuffle(newCards);
    } else if (displayOrder.newSortOrder === 'template') {
      newCards.sort((a, b) => a.templateOrd - b.templateOrd);
    } else if (displayOrder.newSortOrder === 'templateRandom') {
      // Anki: "Card type, then random" — template groups in order, shuffled inside
      const ords = [...new Set(newCards.map((c) => c.templateOrd))].sort((a, b) => a - b);
      const out: Card[] = [];
      for (const ord of ords) {
        const group = newCards.filter((c) => c.templateOrd === ord);
        shuffle(group);
        out.push(...group);
      }
      newCards = out;
    } else if (displayOrder.newSortOrder === 'noteThenCardType') {
      // Anki: "Random note, then card type"
      const noteIds = [...new Set(newCards.map((c) => c.noteId))];
      shuffle(noteIds);
      const out: Card[] = [];
      for (const noteId of noteIds) {
        out.push(
          ...newCards
            .filter((c) => c.noteId === noteId)
            .sort((a, b) => a.templateOrd - b.templateOrd)
        );
      }
      newCards = out;
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
      case 'dueDeck': {
        // Anki: "Due date, then deck"
        reviews.sort((a, b) => {
          if (a.due !== b.due) return a.due - b.due;
          const na = deckNameOf(a.deckId);
          const nb = deckNameOf(b.deckId);
          return na < nb ? -1 : na > nb ? 1 : 0;
        });
        break;
      }
      case 'deckThenDue': {
        // Anki: "Deck, then due date"
        reviews.sort((a, b) => {
          const na = deckNameOf(a.deckId);
          const nb = deckNameOf(b.deckId);
          if (na !== nb) return na < nb ? -1 : 1;
          return a.due - b.due;
        });
        break;
      }
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
      case 'retrievabilityAsc': {
        // FSRS equivalent of Anki's "Relative overdueness": most-forgettable first
        const rOf = (c: Card): number =>
          c.fsrs.stability > 0
            ? fsrsEngine.retrievability(c.fsrs.elapsedDays, c.fsrs.stability)
            : 1;
        reviews.sort((a, b) => rOf(a) - rOf(b));
        break;
      }
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
  }, [deck, schedulerConfig, fsrsEngine]);

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

    // Leech action (Anki): both suspend and tag label the note with "leech";
    // suspend additionally hides the card until it is manually enabled again
    if (hitLeech) {
      const notes = StorageService.getNotes().map((n) =>
        n.id === currentCard.noteId && !n.tags.includes('leech')
          ? { ...n, tags: [...n.tags, 'leech'], updatedAt: Date.now() }
          : n
      );
      StorageService.saveNotes(notes);
      setLeechNotice(
        schedulerConfig.leechAction === 'suspend'
          ? `Leech: card suspenso após ${nextCardData.lapses} lapsos`
          : `Leech: nota marcada com a etiqueta "leech" (${nextCardData.lapses} lapsos)`
      );
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
      <div className="flex flex-col items-center justify-center min-h-[500px] p-6 text-center ios-fade-in">
        <div className="w-20 h-20 rounded-full bg-ios-green/10 border border-ios-green/20 flex items-center justify-center text-ios-green mb-6">
          <CheckCircle2 className="w-10 h-10 stroke-[2.2]" />
        </div>

        <h2 className="text-[28px] font-bold tracking-tight text-zinc-900 dark:text-white mb-2">
          Parabéns!
        </h2>
        <p className="text-[15px] text-zinc-500 dark:text-zinc-400 max-w-sm mb-6">
          Você revisou todas as cartas programadas para hoje no deck{' '}
          <span className="font-semibold text-zinc-700 dark:text-zinc-200">"{deck.name}"</span>.
        </p>

        <div className="flex items-center gap-6 p-4 rounded-[16px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.05] dark:border-white/[0.08] mb-8 text-left">
          <div>
            <div className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
              Revisados nesta sessão
            </div>
            <div className="text-[19px] font-bold tabular-nums text-zinc-900 dark:text-white">
              {sessionReviewedCount}
            </div>
          </div>
          <div className="h-8 w-px bg-black/[0.08] dark:bg-white/[0.12]" />
          <div>
            <div className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
              Retenção alvo
            </div>
            <div className="text-[19px] font-bold tabular-nums text-ios-blue">
              {Math.round(fsrsEngine.getParameters().requestRetention * 100)}%
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-2.5 rounded-full bg-ios-blue hover:bg-[#0071eb] text-white font-semibold text-[15px] transition-all shadow-[0_2px_10px_rgba(0,122,255,0.35)] active:scale-95"
          >
            Voltar aos Decks
          </button>
          <button
            type="button"
            onClick={() => {
              loadDueCards();
              setSessionReviewedCount(0);
            }}
            className="flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-black/[0.06] dark:bg-white/[0.1] hover:bg-black/[0.1] dark:hover:bg-white/[0.15] text-zinc-800 dark:text-zinc-100 font-semibold text-[15px] transition-all active:scale-95"
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
      {/* iOS Navigation Bar */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center mb-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="flex items-center text-ios-blue font-medium text-[15px] pl-1 pr-2.5 py-1 -ml-1 rounded-full hover:bg-ios-blue/10 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" strokeWidth={2.5} />
            <span>Decks</span>
          </button>
        </div>

        <div className="text-[15px] font-semibold text-zinc-900 dark:text-zinc-100 truncate max-w-[220px] text-center">
          {deck.name}
        </div>

        <div className="flex items-center justify-end gap-1.5">
          <span
            className="px-2.5 py-1 rounded-full bg-black/[0.05] dark:bg-white/[0.1] text-[12px] font-semibold tabular-nums text-zinc-600 dark:text-zinc-300"
            title="Cards restantes na sessão"
          >
            {cards.length}
          </span>
          <button
            type="button"
            onClick={() => setShowFSRSDetails((prev) => !prev)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] transition-colors"
            title="Ver Parâmetros do Card"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Live card params inspector */}
      {showFSRSDetails && (
        <div className="mb-4 p-4 rounded-[16px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.05] dark:border-white/[0.08] shadow-[0_1px_3px_rgba(0,0,0,0.05)] ios-fade-in">
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold text-[13px] text-zinc-800 dark:text-zinc-100 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-ios-blue" />
              Parâmetros em Tempo Real
            </span>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-black/[0.05] dark:bg-white/[0.1] text-zinc-500 dark:text-zinc-400">
              {currentCard.fsrs.state === 0 ? 'Novo' : currentCard.fsrs.state === 1 ? 'Aprendizado' : currentCard.fsrs.state === 2 ? 'Revisão' : 'Reaprendizado'}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="p-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.06]">
              <div className="text-zinc-400 dark:text-zinc-500 text-[10px] font-medium">Estabilidade</div>
              <div className="font-bold tabular-nums text-[13px] text-ios-blue">{currentCard.fsrs.stability.toFixed(2)}d</div>
            </div>
            <div className="p-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.06]">
              <div className="text-zinc-400 dark:text-zinc-500 text-[10px] font-medium">Dificuldade</div>
              <div className="font-bold tabular-nums text-[13px] text-ios-orange">{currentCard.fsrs.difficulty.toFixed(2)}<span className="text-zinc-400 font-medium">/10</span></div>
            </div>
            <div className="p-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.06]">
              <div className="text-zinc-400 dark:text-zinc-500 text-[10px] font-medium">Repetições</div>
              <div className="font-bold tabular-nums text-[13px] text-zinc-700 dark:text-zinc-200">{currentCard.fsrs.reps}</div>
            </div>
            <div className="p-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.06]">
              <div className="text-zinc-400 dark:text-zinc-500 text-[10px] font-medium">Lapses</div>
              <div className="font-bold tabular-nums text-[13px] text-ios-red">{currentCard.fsrs.lapses}</div>
            </div>
          </div>
        </div>
      )}

      {/* Main Flashcard Container */}
      <div className="flex-1 flex flex-col justify-between p-6 sm:p-8 rounded-[20px] bg-ios-card dark:bg-ios-card-dark border border-black/[0.04] dark:border-white/[0.06] shadow-[0_2px_12px_rgba(0,0,0,0.06)] relative overflow-hidden transition-shadow min-h-[380px]">
        {/* Dynamic NoteType Custom CSS */}
        {noteType?.css && (
          <style dangerouslySetInnerHTML={{ __html: noteType.css }} />
        )}

        {/* Edit button (like Anki's Edit during review) */}
        {currentCard && (
          <button
            type="button"
            onClick={() => currentCard && setEditNoteId(currentCard.noteId)}
            className="absolute top-3.5 right-3.5 z-40 w-9 h-9 rounded-full bg-black/[0.04] dark:bg-white/[0.08] backdrop-blur-md text-zinc-500 dark:text-zinc-400 hover:text-ios-blue transition-colors active:scale-95 flex items-center justify-center"
            title="Editar este card"
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
            <div className="anki-back-wrapper prose prose-zinc dark:prose-invert max-w-none text-zinc-900 dark:text-zinc-100 font-sans leading-relaxed ios-fade-in">
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
        <div className="mt-8">
          {!isAnswerRevealed ? (
            <button
              type="button"
              onClick={handleRevealAnswer}
              className="w-full h-12 rounded-[16px] bg-ios-blue hover:bg-[#0071eb] text-white font-semibold text-[16px] shadow-[0_4px_14px_rgba(0,122,255,0.35)] transition-all active:scale-[0.98] flex items-center justify-center gap-2"
            >
              <span>Mostrar Resposta</span>
              <span className="hidden sm:inline-block px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-white/20">
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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-full bg-ios-orange text-white text-[13px] font-semibold shadow-[0_8px_24px_rgba(255,149,0,0.4)] ios-fade-in">
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
