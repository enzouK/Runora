/**
 * CardPreview — pure helpers used by the CardBrowser to render per-field
 * previews that RESPECT the note type's template filters.
 *
 * A field's `Kanji[Kana]` notation is only treated as furigana when the note
 * type's template actually uses `{{furigana:Field}}` (same for {{kanji:}} and
 * {{kana:}}) — never globally.
 *
 * Kept free of React/DOM dependencies so it can be unit-tested in Node.
 * Entity characters are built via fromCharCode to avoid source-encoding issues.
 */

import { ClozeService } from './clozeService';

const CH_AMP = String.fromCharCode(38); // &
const CH_LT = String.fromCharCode(60); // <
const CH_GT = String.fromCharCode(62); // >
const CH_QUOT = String.fromCharCode(34); // "
const CH_APOS = String.fromCharCode(39); // '

/** How a note type's template asks for a field to be rendered. */
export type FieldRenderMode = 'plain' | 'furigana' | 'kanji' | 'kana';

/** CardBrowser list ordering modes. */
export type CardSortMode = 'newest' | 'oldest' | 'hardest' | 'easiest';

/** Structural minimum needed to sort preview cards (works with the Card type). */
interface SortableCard {
  id: string;
  createdAt: number;
  fsrs: { difficulty: number };
}

/**
 * Sorts cards for the CardBrowser list.
 * - newest/oldest: by createdAt (id as stable tie-break)
 * - hardest/easiest: by FSRS difficulty; ties (e.g. unseen cards sharing the
 *   default D) broken by createdAt DESC
 * Returns a new array; the input is not mutated.
 */
export function sortCardsByMode<T extends SortableCard>(cards: T[], mode: CardSortMode): T[] {
  const arr = [...cards];
  switch (mode) {
    case 'oldest':
      arr.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
      break;
    case 'hardest':
      arr.sort((a, b) => b.fsrs.difficulty - a.fsrs.difficulty || b.createdAt - a.createdAt);
      break;
    case 'easiest':
      arr.sort((a, b) => a.fsrs.difficulty - b.fsrs.difficulty || b.createdAt - a.createdAt);
      break;
    case 'newest':
    default:
      arr.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1));
      break;
  }
  return arr;
}

/**
 * Multi-select filter toggle used by the CardBrowser dropdowns.
 * The special value 'all' clears the selection (shows everything);
 * any other value toggles its membership. Returns a new array.
 */
export function toggleMultiFilter(values: string[], value: string): string[] {
  if (value === 'all') return [];
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Scans a note type's templates (qfmt + afmt) and reports, per field name,
 * which Anki filter the template requests for it. Plain {{Field}} or no
 * reference at all → 'plain'.
 */
export function detectFieldModes(
  templates: Array<{ qfmt: string; afmt: string }>,
  fieldNames: string[]
): Record<string, FieldRenderMode> {
  const haystack = templates.map((t) => `${t.qfmt}\n${t.afmt}`).join('\n');
  const modes: Record<string, FieldRenderMode> = {};
  for (const name of fieldNames) {
    const esc = escapeRegExp(name);
    if (new RegExp(`\\{\\{furigana:\\s*${esc}\\s*\\}\\}`, 'i').test(haystack)) {
      modes[name] = 'furigana';
    } else if (new RegExp(`\\{\\{kanji:\\s*${esc}\\s*\\}\\}`, 'i').test(haystack)) {
      modes[name] = 'kanji';
    } else if (new RegExp(`\\{\\{kana:\\s*${esc}\\s*\\}\\}`, 'i').test(haystack)) {
      modes[name] = 'kana';
    } else {
      modes[name] = 'plain';
    }
  }
  return modes;
}

/**
 * Resolves the display field order for a note type.
 * The user's preference order WINS (first item = primary field); fields that
 * no longer exist on the note type are dropped. Without a preference, the
 * first two fields by ord are used.
 */
export function resolveDisplayFields(fieldNamesByOrd: string[], pref?: string[]): string[] {
  if (pref && pref.length > 0) {
    const chosen = pref.filter((n) => fieldNamesByOrd.includes(n));
    if (chosen.length > 0) return chosen;
  }
  return fieldNamesByOrd.slice(0, 2);
}

/**
 * Promotes a field to primary (front of the selection). Works even when no
 * preference exists yet — the default selection (first two by ord) is used
 * as the starting point, exactly like the chips' fallback.
 * Returns the new ordered list, or null when nothing would change
 * (no fields, or the field is already the primary).
 */
export function promoteFieldToPrimary(
  pref: string[] | undefined,
  fieldNamesByOrd: string[],
  fieldName: string
): string[] | null {
  const current =
    pref && pref.length > 0
      ? pref.filter((n) => fieldNamesByOrd.includes(n))
      : fieldNamesByOrd.slice(0, 2);
  if (current.length === 0 || current[0] === fieldName) return null;
  return [fieldName, ...current.filter((n) => n !== fieldName)];
}

/** Decodes the common HTML entities produced by rich-text editors. */
function decodeEntities(s: string): string {
  return s.replace(/&(nbsp|amp|lt|gt|quot|apos|#39|#x27|#x2f);/gi, (_ent, name: string) => {
    switch (name.toLowerCase()) {
      case 'nbsp':
        return ' ';
      case 'amp':
        return CH_AMP;
      case 'lt':
        return CH_LT;
      case 'gt':
        return CH_GT;
      case 'quot':
        return CH_QUOT;
      case 'apos':
      case '#39':
      case '#x27':
        return CH_APOS;
      case '#x2f':
        return '/';
      default:
        return _ent;
    }
  });
}

/**
 * Removes Anki media tags ([sound:...]) and reveals cloze text
 * ({{c1::answer::hint}} → answer) while KEEPING all other HTML intact.
 * Same cloze semantics as ClozeService.renderClozeBack.
 */
export function revealSoundAndCloze(html: string): string {
  if (!html) return '';
  return html
    .replace(/\[sound:[^\]]*\]/gi, ' ')
    .replace(/\{\{c\d+::([^}]*?)(?:::([^}]*?))?\}\}/gi, '$1');
}

/** Strips tags/entities and collapses whitespace for a compact text preview. */
export function stripHtml(html: string): string {
  if (!html) return '';
  // Line-level tags become real newlines BEFORE stripping, so <br> keeps paragraphs
  const withBreaks = revealSoundAndCloze(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote)>/gi, '\n');
  const text = decodeEntities(withBreaks.replace(/<[^>]*>/g, ' '));
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * HTML preview for a field referenced with {{furigana:Field}} in the template:
 * converts `漢字[かんじ]` into real <ruby> markup (like the study view does).
 * Media tags and cloze markers are resolved first so they never leak.
 */
export function furiganaPreviewHtml(html: string): string {
  if (!html) return '';
  return ClozeService.renderFurigana(revealSoundAndCloze(html));
}

/**
 * Text preview for a field referenced with {{kanji:Field}} / {{kana:Field}}.
 * {{kanji:}} keeps kanji and drops the reading; {{kana:}} does the opposite.
 */
export function kanjiPreviewText(html: string): string {
  if (!html) return '';
  return stripHtml(ClozeService.renderKanjiOnly(revealSoundAndCloze(html)));
}

export function kanaPreviewText(html: string): string {
  if (!html) return '';
  return stripHtml(ClozeService.renderKanaOnly(revealSoundAndCloze(html)));
}

/**
 * First image reference in a field HTML: img tag src, bare image URL.
 * Returns the raw reference (filename, http URL or data URI) — resolution
 * against MediaStore is the caller's job.
 */
export function extractFirstImage(html: string): string | null {
  if (!html) return null;
  const tag = html.match(
    new RegExp('<img[^>]+src=["' + CH_QUOT + CH_APOS + ']([^"' + CH_QUOT + CH_APOS + ']+)', 'i')
  );
  if (tag) return tag[1];
  const bare = html.match(
    /(https?:\/\/[^\s<>"']+\.(?:png|jpe?g|webp|gif|svg|avif)(?:\?[^\s<>"']*)?)/i
  );
  return bare ? bare[1] : null;
}

/**
 * First audio reference in a field HTML: [sound:...], audio tag src or
 * bare audio URL (.mp3/.wav/.ogg/.m4a/.aac/.opus).
 */
export function extractFirstAudio(html: string): string | null {
  if (!html) return null;
  const sound = html.match(/\[sound:([^\]]+)\]/i);
  if (sound) return sound[1].trim();
  const tag = html.match(
    new RegExp('<audio[^>]+src=["' + CH_QUOT + CH_APOS + ']([^"' + CH_QUOT + CH_APOS + ']+)', 'i')
  );
  if (tag) return tag[1];
  const bare = html.match(
    /(https?:\/\/[^\s<>"']*(?:\.mp3|\.wav|\.ogg|\.m4a|\.aac|\.opus)(?:\?[^\s<>"']*)?)/i
  );
  return bare ? bare[1] : null;
}
