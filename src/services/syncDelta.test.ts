/**
 * Fase 7 — Testes do formato de delta (sync incremental).
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { StorageService } from './storage';
import {
  buildDelta,
  applyDelta,
  isValidDelta,
  detectConflicts,
  DELTA_FORMAT_VERSION,
  type SyncDelta,
  type DeltaMeta,
  type SyncConflict,
} from './syncDelta';
import type { Deck, NoteType, Note, Card, RevlogEntry, Preset, Tombstone } from '../types/runora';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string): void { this.map.set(key, String(value)); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
}

Object.defineProperty(globalThis, 'localStorage', {
  value: new MemoryStorage(),
  configurable: true,
  writable: true,
});

function makeDeck(partial: Partial<Deck> = {}): Deck {
  return {
    id: partial.id ?? `deck-${Date.now()}`,
    name: partial.name ?? 'Test Deck',
    description: '',
    createdAt: partial.createdAt ?? Date.now(),
    updatedAt: partial.updatedAt ?? Date.now(),
    usn: partial.usn,
  };
}

function makeNoteType(partial: Partial<NoteType> = {}): NoteType {
  return {
    id: partial.id ?? `nt-${Date.now()}`,
    name: partial.name ?? 'Basic',
    fields: [],
    templates: [],
    css: '',
    isCloze: false,
    hintsEnabled: false,
    voiceRecordingEnabled: false,
    furiganaEnabled: false,
    createdAt: partial.createdAt ?? Date.now(),
    updatedAt: partial.updatedAt ?? Date.now(),
    usn: partial.usn,
  };
}

function makeNote(partial: Partial<Note> = {}): Note {
  return {
    id: partial.id ?? `note-${Date.now()}`,
    noteTypeId: partial.noteTypeId ?? 'nt-1',
    deckId: partial.deckId ?? 'deck-1',
    fields: {},
    media: [],
    tags: [],
    createdAt: partial.createdAt ?? Date.now(),
    updatedAt: partial.updatedAt ?? Date.now(),
    usn: partial.usn,
    guid: partial.guid,
  };
}

function makeCard(partial: Partial<Card> = {}): Card {
  return {
    id: partial.id ?? `card-${Date.now()}`,
    noteId: partial.noteId ?? 'note-1',
    deckId: partial.deckId ?? 'deck-1',
    templateOrd: 0,
    due: 0,
    fsrs: { stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 0, lapses: 0, state: 0, lastReview: null },
    createdAt: partial.createdAt ?? Date.now(),
    updatedAt: partial.updatedAt ?? Date.now(),
    usn: partial.usn,
  };
}

function makeRevlog(partial: Partial<RevlogEntry> = {}): RevlogEntry {
  return {
    id: partial.id ?? `rev-${Date.now()}`,
    cardId: partial.cardId ?? 'card-1',
    noteId: partial.noteId ?? 'note-1',
    rating: 3,
    reviewTime: Date.now(),
    elapsedDays: 0,
    scheduledDays: 1,
    state: 2,
    stability: 1,
    difficulty: 5,
    usn: partial.usn,
  };
}

function makePreset(partial: Partial<Preset> = {}): Preset {
  return {
    id: partial.id ?? `preset-${Date.now()}`,
    name: partial.name ?? 'Default',
    dailyLimits: { newCardsPerDay: 20, maxReviewsPerDay: 200 },
    schedulerConfig: { learningSteps: '1m 10m', insertionOrder: 'sequential', relearningSteps: '10m', leechThreshold: 8, leechAction: 'suspend' },
    displayOrder: { newGatherOrder: 'deck', newSortOrder: 'gathered', newReviewOrder: 'mix', learnReviewOrder: 'mix', reviewSortOrder: 'dueRandom' },
    audioConfig: { disableAutoplay: false },
    fsrsParams: { requestRetention: 0.9, maximumInterval: 36500 },
    createdAt: partial.createdAt ?? Date.now(),
    updatedAt: partial.updatedAt ?? Date.now(),
    usn: partial.usn,
  };
}

function makeTombstone(partial: Partial<Tombstone> = {}): Tombstone {
  return {
    type: partial.type ?? 'note',
    id: partial.id ?? 'deleted-id',
    usn: partial.usn ?? 1,
    deletedAt: partial.deletedAt ?? Date.now(),
  };
}

describe('Fase 7.2 — Formato de delta (sync incremental)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('buildDelta cria payload válido com versão e contadores', () => {
    const delta = buildDelta(10, 25, 'device-1', 'Meu Celular', {
      decks: [makeDeck({ id: 'd1', usn: 20 })],
      noteTypes: [makeNoteType({ id: 'nt1', usn: 21 })],
      notes: [makeNote({ id: 'n1', usn: 22 })],
      cards: [makeCard({ id: 'c1', usn: 23 })],
      revlog: [makeRevlog({ id: 'r1', usn: 24 })],
      presets: [makePreset({ id: 'p1', usn: 25 })],
      tombstones: [makeTombstone({ id: 'old-note', usn: 15 })],
      mediaManifest: { 'abc123': 'image.png' },
    });

    assert.equal(delta.version, DELTA_FORMAT_VERSION);
    assert.equal(delta.baseUsn, 10);
    assert.equal(delta.currentUsn, 25);
    assert.equal(delta.deviceId, 'device-1');
    assert.equal(delta.deviceName, 'Meu Celular');
    assert.equal(delta.decks.length, 1);
    assert.equal(delta.notes.length, 1);
    assert.equal(delta.tombstones.length, 1);
    assert.equal(Object.keys(delta.mediaManifest).length, 1);
  });

  it('isValidDelta aceita delta válido e rejeita inválido', () => {
    const good = buildDelta(0, 5, 'dev', 'Dev', {
      decks: [], noteTypes: [], notes: [], cards: [], revlog: [], presets: [], tombstones: [], mediaManifest: {}
    });
    assert.equal(isValidDelta(good), true);

    assert.equal(isValidDelta(null), false);
    assert.equal(isValidDelta({}), false);
    assert.equal(isValidDelta({ version: 999 }), false); // versão errada
    assert.equal(isValidDelta({ version: DELTA_FORMAT_VERSION, baseUsn: 'x' }), false); // baseUsn não é number
  });

  it('applyDelta aplica tombstones primeiro, depois entidades', () => {
    const applied: string[] = [];
    const delta = buildDelta(0, 5, 'dev', 'Dev', {
      decks: [makeDeck({ id: 'd1', usn: 1 })],
      noteTypes: [],
      notes: [makeNote({ id: 'n1', usn: 2 })],
      cards: [],
      revlog: [],
      presets: [],
      tombstones: [makeTombstone({ type: 'note', id: 'n1', usn: 3 })],
      mediaManifest: {},
    });

    const newHead = applyDelta(delta,
      (entity, type) => applied.push(`${type}:${(entity as { id: string }).id}`),
      (t) => applied.push(`tombstone:${t.type}:${t.id}`)
    );

    assert.equal(newHead, 5);
    // Tombstone vem primeiro
    assert.equal(applied[0], 'tombstone:note:n1');
    // Depois as entidades
    assert.ok(applied.includes('deck:d1'));
    assert.ok(applied.includes('note:n1'));
  });

  it('DeltaMeta tem estrutura correta', () => {
    const meta: DeltaMeta = {
      app: 'runora',
      version: 1,
      baseUsn: 100,
      headUsn: 150,
      syncedAt: Date.now(),
      deviceId: 'device-1',
      deviceName: 'PC',
      counts: { decks: 2, noteTypes: 1, notes: 50, cards: 120, revlog: 300, presets: 3, tombstones: 5, mediaFiles: 10 },
    };
    assert.equal(meta.app, 'runora');
    assert.equal(meta.counts.notes, 50);
  });
});

describe('Fase 7.6 — Detecção de conflitos por USN divergente', () => {
  const baseUsn = 100;

  function localNote(partial: Partial<Note> = {}): Note {
    return makeNote({ guid: 'guid-A', usn: 110, ...partial });
  }
  function remoteNote(partial: Partial<Note> = {}): Note {
    return makeNote({ guid: 'guid-A', usn: 120, ...partial });
  }
  function localDeck(partial: Partial<Deck> = {}): Deck {
    return makeDeck({ name: 'Meu Deck', usn: 110, ...partial });
  }
  function remoteDeck(partial: Partial<Deck> = {}): Deck {
    return makeDeck({ name: 'Meu Deck', usn: 120, ...partial });
  }

  it('detecta conflito em nota (mesmo GUID, USN divergente > baseUsn)', () => {
    const result = detectConflicts(baseUsn, {
      notes: [localNote({ id: 'local-n1', fields: { Frente: 'gato' } })],
      decks: [], noteTypes: [], cards: [], presets: []
    }, {
      notes: [remoteNote({ id: 'remote-n1', fields: { Frente: 'cat' } })],
      decks: [], noteTypes: [], cards: [], presets: []
    });

    assert.equal(result.hasConflicts, true);
    assert.equal(result.conflicts.length, 1);
    const c = result.conflicts[0];
    assert.equal(c.type, 'note');
    assert.equal(c.guid, 'guid-A');
    assert.equal(c.localUsn, 110);
    assert.equal(c.remoteUsn, 120);
  });

  it('NÃO detecta conflito se só um lado mudou (outro lado usn <= baseUsn)', () => {
    const result = detectConflicts(baseUsn, {
      notes: [localNote({ usn: 110 })],
      decks: [], noteTypes: [], cards: [], presets: []
    }, {
      notes: [remoteNote({ usn: 90 })], // <= baseUsn = não mudou
      decks: [], noteTypes: [], cards: [], presets: []
    });

    assert.equal(result.hasConflicts, false);
    assert.equal(result.conflicts.length, 0);
  });

  it('NÃO detecta conflito se USNs são iguais (mesma mudança)', () => {
    const result = detectConflicts(baseUsn, {
      notes: [localNote({ usn: 110 })],
      decks: [], noteTypes: [], cards: [], presets: []
    }, {
      notes: [remoteNote({ usn: 110 })],
      decks: [], noteTypes: [], cards: [], presets: []
    });

    assert.equal(result.hasConflicts, false);
  });

  it('detecta conflito em deck (mesmo nome, USN divergente)', () => {
    const result = detectConflicts(baseUsn, {
      decks: [localDeck({ usn: 110 })],
      notes: [], noteTypes: [], cards: [], presets: []
    }, {
      decks: [remoteDeck({ usn: 120 })],
      notes: [], noteTypes: [], cards: [], presets: []
    });

    assert.equal(result.hasConflicts, true);
    assert.equal(result.conflicts[0].type, 'deck');
  });

  it('detecta múltiplos conflitos independentes', () => {
    const result = detectConflicts(baseUsn, {
      notes: [localNote({ id: 'n1', guid: 'g1', usn: 110 }), localNote({ id: 'n2', guid: 'g2', usn: 115 })],
      decks: [localDeck({ name: 'Deck1', usn: 110 })],
      noteTypes: [], cards: [], presets: []
    }, {
      notes: [remoteNote({ id: 'n1', guid: 'g1', usn: 120 }), remoteNote({ id: 'n2', guid: 'g2', usn: 125 })],
      decks: [remoteDeck({ name: 'Deck1', usn: 120 })],
      noteTypes: [], cards: [], presets: []
    });

    assert.equal(result.hasConflicts, true);
    assert.equal(result.conflicts.length, 3); // 2 notas + 1 deck
  });

  it('cards: conflito por noteId:templateOrd', () => {
    const result = detectConflicts(baseUsn, {
      cards: [makeCard({ id: 'c1', noteId: 'n1', templateOrd: 0, usn: 110 })],
      notes: [], decks: [], noteTypes: [], presets: []
    }, {
      cards: [makeCard({ id: 'c1', noteId: 'n1', templateOrd: 0, usn: 120 })],
      notes: [], decks: [], noteTypes: [], presets: []
    });

    assert.equal(result.hasConflicts, true);
    assert.equal(result.conflicts[0].type, 'card');
  });
});