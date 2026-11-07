import { Deck, Note, NoteType, Card } from '../types/runora';

/**
 * New collections start clean (like a fresh profile):
 * - A single "Padrão" deck (the structural "Default" deck)
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
    furiganaEnabled: false,
    fields: [
      { id: 'f-front', name: 'Frente', ord: 0, description: 'Pergunta ou termo' },
      { id: 'f-back', name: 'Verso', ord: 1, description: 'Resposta ou explicação' },
    ],
    templates: [
      {
        id: 'tmpl-basic-1',
        name: 'Card 1',
        ord: 0,
        qfmt: '<div class="runora-field runora-field--frente">{{Frente}}</div>',
        afmt: '{{FrontSide}}<hr id="answer" /><div class="runora-field runora-field--verso">{{Verso}}</div>',
      },
    ],
    css: '.card {\n  font-size: 20px;\n}\n\n.runora-field--frente {\n  font-size: 24px;\n}\n\n.runora-field--verso {\n  font-size: 24px;\n}',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'nt-cloze',
    name: 'Omissão de Palavras (Cloze)',
    isCloze: true,
    hintsEnabled: false,
    voiceRecordingEnabled: false,
    furiganaEnabled: false,
    fields: [
      { id: 'f-text', name: 'Frente', ord: 0, description: 'Texto com {{c1::palavra::dica}}' },
      { id: 'f-extra', name: 'Verso', ord: 1, description: '' },
    ],
    templates: [
      {
        id: 'tmpl-cloze-1',
        name: 'Cloze Card',
        ord: 0,
        qfmt: '<div class="runora-field runora-field--cloze-frente">{{cloze:Frente}}</div>',
        afmt: '{{FrontSide}}<hr id="answer" /><div class="runora-field runora-field--verso">{{Verso}}</div>',
      },
    ],
    css: '.card {\n  font-size: 20px;\n}\n\n.runora-field--cloze-frente {\n  font-size: 24px;\n}\n\n.runora-field--verso {\n  font-size: 24px;\n}',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'nt-shadowing',
    name: 'Shadowing',
    isCloze: false,
    hintsEnabled: true,
    voiceRecordingEnabled: true,
    furiganaEnabled: false,
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
        qfmt: '<div class="runora-field runora-field--audio">{{Áudio}}</div>\n<div class="runora-field runora-field--voice-record">{{voice:record}}</div>\n<div class="runora-field runora-field--hint-frase">{{hint:Frase}}</div>',
        // Back: hear again, compare with your recording, read phrase & translation
        afmt: '{{FrontSide}}<hr id="answer" /><div class="runora-field runora-field--voice-reproduce">{{voice:reproduce}}</div><div class="runora-field runora-field--traducao">{{Tradução}}</div>',
      },
    ],
    css: '.card {\n  font-size: 20px;\n}\n\n.runora-field--audio {\n  font-size: 24px;\n}\n\n.runora-field--voice-record {\n  font-size: 24px;\n}\n\n.runora-field--hint-frase {\n  font-size: 24px;\n}\n\n.runora-field--voice-reproduce {\n  font-size: 24px;\n}\n\n.runora-field--traducao {\n  font-size: 24px;\n}',
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
