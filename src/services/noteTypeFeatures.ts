/**
 * Recursos (features) do Note Type.
 *
 * Cada recurso liga/desliga um botão do editor de templates:
 *
 *   - furigana -> botão "+furigana"   ({{furigana:Campo}})
 *   - hints    -> botão "+hint"       ({{hint:Campo}})
 *   - voice    -> botões "+voice:record" e "+voice:reproduce"
 *   - cloze    -> botão "+cloze"      ({{cloze:Campo}})
 *
 * Desligar um recurso NÃO mexe no HTML nem no CSS do template: só
 * esconde o botão. Assim o usuário pode desligar e religar sem
 * perder o trabalho que já fez no template.
 */
import { Card, CardTemplate, Note, NoteType } from '../types/runora';

/** Recursos que podem ser ligados/desligados por tipo de nota. */
export type NoteTypeFeature = 'furigana' | 'hints' | 'voice' | 'cloze';

export interface NoteTypeFeatureInfo {
  /** Nome do recurso (ex.: "Furigana"). */
  label: string;
  /** Descrição curta do que o recurso faz. */
  description: string;
  /** Exemplo da tag usada no HTML. */
  tagExample: string;
  /** Botão que aparece no editor de templates quando o recurso está ligado. */
  buttonLabel: string;
  /** Regex (sem a flag global) que encontra o recurso no HTML. */
  pattern: RegExp;
  /** Regex (com a flag global) que encontra todas as tags do recurso. */
  tagsPattern: RegExp;
}

export const NOTE_TYPE_FEATURES: Record<NoteTypeFeature, NoteTypeFeatureInfo> = {
  furigana: {
    label: 'Furigana',
    description: 'Ativa {{furigana:Campo}} no HTML (converte 漢字[かんじ] em ruby)',
    tagExample: '{{furigana:Campo}}',
    buttonLabel: '+furigana',
    pattern: /\{\{\s*(?:furigana|kanji|kana)\s*:[^}]*\}\}/i,
    tagsPattern: /\{\{\s*(?:furigana|kanji|kana)\s*:[^}]*\}\}/gi,
  },
  hints: {
    label: 'Dicas',
    description: 'Ativa {{hint:Campo}} no HTML (botão "Show Hint" no card)',
    tagExample: '{{hint:Campo}}',
    buttonLabel: '+hint',
    pattern: /\{\{\s*hint\s*(?::[^}]*)?\}\}/i,
    tagsPattern: /\{\{\s*hint\s*(?::[^}]*)?\}\}/gi,
  },
  voice: {
    label: 'Gravação de Voz',
    description: 'Ativa {{voice:record}} e {{voice:reproduce}} no HTML',
    tagExample: '{{voice:record}}',
    buttonLabel: '+voice:record',
    pattern: /\{\{\s*voice\s*:\s*(?:record|reproduce)\s*\}\}/i,
    tagsPattern: /\{\{\s*voice\s*:\s*(?:record|reproduce)\s*\}\}/gi,
  },
  cloze: {
    label: 'Omissão de Palavras',
    description: 'Ativa {{cloze:Campo}} no HTML (processa marcações {{c1::palavra}})',
    tagExample: '{{cloze:Campo}}',
    buttonLabel: '+cloze',
    pattern: /\{\{\s*cloze\s*:[^}]*\}\}/i,
    tagsPattern: /\{\{\s*cloze\s*:[^}]*\}\}/gi,
  },
};

/** O HTML usa este recurso? */
export const htmlUsesFeature = (html: string, feature: NoteTypeFeature): boolean =>
  NOTE_TYPE_FEATURES[feature].pattern.test(html || '');

/**
 * Qual recurso pertence a esta tag?
 * (null = tag normal de um campo do tipo de nota)
 */
export const featureOfTag = (tag: string): NoteTypeFeature | null => {
  const nome = (tag || '').trim();
  const lower = nome.toLowerCase();

  if (lower === 'hint' || lower.startsWith('hint:')) return 'hints';
  if (/^(furigana|kanji|kana):/i.test(nome)) return 'furigana';
  if (/^cloze:/i.test(nome)) return 'cloze';
  if (lower.startsWith('voice:')) return 'voice';
  return null;
};

/** O tipo de nota usa este recurso em algum template? */
export const noteTypeUsesFeature = (
  noteType: NoteType,
  feature: NoteTypeFeature
): boolean =>
  (noteType.templates || []).some(
    (t) => htmlUsesFeature(t.qfmt, feature) || htmlUsesFeature(t.afmt, feature)
  );

/** Descobre quais recursos o HTML dos templates usa. */
export const detectFeatures = (
  templates: CardTemplate[]
): Record<NoteTypeFeature, boolean> => {
  const usa = (feature: NoteTypeFeature) =>
    (templates || []).some(
      (t) => htmlUsesFeature(t.qfmt, feature) || htmlUsesFeature(t.afmt, feature)
    );

  return {
    furigana: usa('furigana'),
    hints: usa('hints'),
    voice: usa('voice'),
    cloze: usa('cloze'),
  };
};

/**
 * Estado dos recursos de um tipo de nota.
 *
 * Tipos criados antes dos recursos não têm a flag gravada — nesses
 * casos o recurso é deduzido do HTML dos templates (assim o botão
 * continua aparecendo para quem já usa a tag no template).
 */
export const resolveFeatures = (
  noteType: NoteType
): Record<NoteTypeFeature, boolean> => {
  const detectado = detectFeatures(noteType.templates || []);
  return {
    furigana: noteType.furiganaEnabled ?? detectado.furigana,
    hints: noteType.hintsEnabled ?? detectado.hints,
    voice: noteType.voiceRecordingEnabled ?? detectado.voice,
    cloze: noteType.isCloze ?? detectado.cloze,
  };
};

/**
 * Quantos cards deste tipo de nota usam o recurso?
 * (todos os cards do tipo usam o mesmo template, então o vale é geral)
 */
export const countCardsUsingFeature = (
  noteType: NoteType,
  feature: NoteTypeFeature,
  notes: Note[],
  cards: Card[]
): number => {
  if (!noteTypeUsesFeature(noteType, feature)) return 0;

  const idsDasNotas = new Set(
    notes.filter((n) => n.noteTypeId === noteType.id).map((n) => n.id)
  );
  if (idsDasNotas.size === 0) return 0;

  return cards.filter((c) => idsDasNotas.has(c.noteId)).length;
};

/**
 * Texto do aviso: quantos cards usam o recurso.
 * (é o único texto do popup — nada mais)
 *
 * Desligar o recurso NÃO apaga o HTML nem o CSS do template, então
 * aqui só falamos de quantos cards estão usando a tag.
 */
export const featureImpactText = (feature: NoteTypeFeature, count: number): string => {
  const info = NOTE_TYPE_FEATURES[feature];
  const tag = info.tagExample;

  if (count === 0) {
    return `Nenhum card deste tipo de nota usa ${tag} no template.`;
  }

  const plural = count > 1;
  return `${count} card${plural ? 's' : ''} deste tipo de nota usa${
    plural ? 'm' : ''
  } ${tag} no template.`;
};
