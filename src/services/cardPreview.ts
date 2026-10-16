/**
 * CardPreview — pure string helpers used by the CardBrowser to render
 * per-field text previews and detect media references inside field HTML.
 *
 * Kept free of React/DOM/IndexedDB dependencies so it can be unit-tested in Node.
 * Entity characters are built via fromCharCode to avoid any source-encoding issues.
 */

const CH_AMP = String.fromCharCode(38); // &
const CH_LT = String.fromCharCode(60); // <
const CH_GT = String.fromCharCode(62); // >
const CH_QUOT = String.fromCharCode(34); // "
const CH_APOS = String.fromCharCode(39); // '

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

/** Strips tags/entities and collapses whitespace for a compact text preview. */
export function stripHtml(html: string): string {
  if (!html) return '';
  // Anki media tags and cloze markers are represented by the media previews,
  // never as raw text. Line-level tags become real newlines BEFORE stripping.
  const withBreaks = html
    .replace(/\[sound:[^\]]*\]/gi, ' ')
    .replace(/\{\{c\d+::([^:}]*)[^}]*\}\}/gi, '$1')
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
 * First image reference in a field HTML: img tag src, bare image URL.
 * Returns the raw reference (filename, http URL or data URI) — resolution
 * against MediaStore is the caller's job.
 */
export function extractFirstImage(html: string): string | null {
  if (!html) return null;
  const tag = html.match(new RegExp('<img[^>]+src=["' + CH_QUOT + CH_APOS + ']([^"' + CH_QUOT + CH_APOS + ']+)', 'i'));
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
  const tag = html.match(new RegExp('<audio[^>]+src=["' + CH_QUOT + CH_APOS + ']([^"' + CH_QUOT + CH_APOS + ']+)', 'i'));
  if (tag) return tag[1];
  const bare = html.match(
    /(https?:\/\/[^\s<>"']*(?:\.mp3|\.wav|\.ogg|\.m4a|\.aac|\.opus)(?:\?[^\s<>"']*)?)/i
  );
  return bare ? bare[1] : null;
}
