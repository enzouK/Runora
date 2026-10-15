import { Deck, Note, NoteType, Card } from '../types/anki';

/**
 * New collections start clean (like a fresh Anki profile):
 * - A single "Padrão" deck (Anki's structural "Default" deck)
 * - 3 note types: Básico, Cloze, Shadowing
 * - No demo notes or cards
 */
export const INITIAL_NOTE_TYPES: NoteType[] = [
  {
    id: 'nt-basic',
    name: 'Básico',
    isCloze: false,
    hintsEnabled: false,
    voiceRecordingEnabled: false,
    fields: [
      { id: 'f-front', name: 'Frente', ord: 0, description: 'Pergunta ou termo' },
      { id: 'f-back', name: 'Verso', ord: 1, description: 'Resposta ou explicação' },
    ],
    templates: [
      {
        id: 'tmpl-basic-1',
        name: 'Card 1',
        ord: 0,
        qfmt: '<div class="anki-front-content">{{Frente}}</div>',
        afmt: '<div class="anki-front-content">{{FrontSide}}</div><hr class="anki-divider my-4 border-black/10 dark:border-white/10" /><div class="anki-back-content">{{Verso}}</div>',
      },
    ],
    css: '.anki-front-content { font-size: 1.25rem; font-weight: 500; }',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'nt-cloze',
    name: 'Omissão de Palavras (Cloze)',
    isCloze: true,
    hintsEnabled: true,
    voiceRecordingEnabled: false,
    fields: [
      { id: 'f-text', name: 'Texto', ord: 0, description: 'Texto com {{c1::palavra::dica}}' },
      { id: 'f-extra', name: 'Extra', ord: 1, description: 'Notas explicativas adicionais' },
    ],
    templates: [
      {
        id: 'tmpl-cloze-1',
        name: 'Cloze Card',
        ord: 0,
        qfmt: '<div class="anki-cloze-prompt">{{cloze:Texto}}</div>',
        afmt: '<div class="anki-cloze-prompt">{{cloze:Texto}}</div><hr class="anki-divider my-4 border-black/10 dark:border-white/10" /><div class="anki-extra-content text-sm opacity-80">{{Extra}}</div>',
      },
    ],
    css: '.anki-cloze-prompt { font-size: 1.15rem; line-height: 1.6; }',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'nt-shadowing',
    name: 'Shadowing',
    isCloze: false,
    hintsEnabled: true,
    voiceRecordingEnabled: true,
    fields: [
      { id: 'f-sentence', name: 'Frase', ord: 0, description: 'Frase no idioma alvo' },
      { id: 'f-audio', name: 'Áudio', ord: 1, description: 'Áudio nativo ([sound:...] ou cole um link)' },
      { id: 'f-translation', name: 'Tradução', ord: 2, description: 'Significado em Português' },
    ],
    templates: [
      {
        id: 'tmpl-shadow-1',
        name: 'Shadowing',
        ord: 0,
        // Front: hear the audio + record your voice (reprodução automática quando ativada no deck)
        qfmt: `<div class="text-xs uppercase tracking-wider text-teal-500 font-semibold mb-2">Shadowing</div>
               <div class="mb-3">{{Áudio}}</div>
               {{hint:Dica}}
               {{voice:record}}`,
        // Back: hear again, compare with your recording, read phrase & translation
        afmt: `{{FrontSide}}
               <hr class="anki-divider my-4 border-black/10 dark:border-white/10" />
               <div class="space-y-3">
                 <div class="text-xl font-semibold">{{Frase}}</div>
                 <div class="text-base text-emerald-600 dark:text-emerald-400">{{Tradução}}</div>
                 {{voice:reproduce}}
               </div>`,
      },
    ],
    css: '.anki-front-content { font-size: 1.2rem; }',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

/**
 * A fresh collection contains only the structural default deck, like Anki's "Default".
 * (You can delete it if you prefer to start completely empty.)
 */
export const INITIAL_DECKS: Deck[] = [
  {
    id: 'deck-default',
    name: 'Padrão',
    description: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

/** New collections come with no notes and no cards. */
export const INITIAL_NOTES: Note[] = [];
export const INITIAL_CARDS: Card[] = [];
