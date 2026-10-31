/**
 * Cloze Parser & Template Engine
 * Full support for:
 * - {{FieldName}}
 * - {{FrontSide}}
 * - {{cloze:FieldName}}
 * - {{hint:FieldName}}
 * - {{furigana:FieldName}}, {{kanji:FieldName}}, {{kana:FieldName}}
 * - Conditional blocks: {{#FieldName}}...{{/FieldName}} and {{^FieldName}}...{{/^FieldName}}
 * - Arbitrary HTML structures (<table>, <span>, inline styles, <hr id="answer">)
 */

export interface ClozeMatch {
  index: number;
  answer: string;
  hint?: string;
  raw: string;
}

export const VOICE_RECORD_SLOT = '<!--VOICE_RECORD_SLOT-->';
export const VOICE_REPRODUCE_SLOT = '<!--VOICE_REPRODUCE_SLOT-->';

export class ClozeService {
  /**
   * Extracts all unique cloze numbers present in a text (e.g. [1, 2] for c1, c2)
   */
  public static extractClozeIndices(text: string): number[] {
    const regex = /\{\{c(\d+)::([^}]*?)(?:::([^}]*?))?\}\}/g;
    const indices = new Set<number>();
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      indices.add(parseInt(match[1], 10));
    }

    return Array.from(indices).sort((a, b) => a - b);
  }

  /**
   * Renders the Cloze text for the card FRONT for a specific cloze ordinal (e.g. 1)
   */
  public static renderClozeFront(text: string, activeIndex: number): string {
    const regex = /\{\{c(\d+)::([^}]*?)(?:::([^}]*?))?\}\}/g;

    return text.replace(regex, (_match, ordStr, answer, hint) => {
      const ord = parseInt(ordStr, 10);
      if (ord === activeIndex) {
        const hintText = hint ? hint.trim() : '...';
        return `<span class="runora-cloze-front-placeholder">[${hintText}]</span>`;
      } else {
        // Other clozes show normal answer
        return answer;
      }
    });
  }

  /**
   * Renders the Cloze text for the card BACK for a specific cloze ordinal
   */
  public static renderClozeBack(text: string, activeIndex: number): string {
    const regex = /\{\{c(\d+)::([^}]*?)(?:::([^}]*?))?\}\}/g;

    return text.replace(regex, (_match, ordStr, answer) => {
      const ord = parseInt(ordStr, 10);
      if (ord === activeIndex) {
        return `<span class="runora-cloze-back-revealed">${answer}</span>`;
      } else {
        return answer;
      }
    });
  }

  /**
   * Converts Furigana format `漢字[かんじ]` into HTML `<ruby>漢字<rt>かんじ</rt></ruby>`
   */
  public static renderFurigana(text: string): string {
    if (!text) return '';
    // Pattern: Kanji followed by [kana] e.g. " 漢字[かんじ]" or "食べる[たべる]"
    return text.replace(/(?:^|\s*)([^\s\[\]]+)\[([^\]]+)\]/g, (_match, kanji, kana) => {
      return `<ruby>${kanji}<rt style="font-size: 0.6em; font-weight: normal;">${kana}</rt></ruby>`;
    });
  }

  /**
   * Strips kana leaving kanji only
   */
  public static renderKanjiOnly(text: string): string {
    if (!text) return '';
    return text.replace(/(?:^|\s*)([^\s\[\]]+)\[([^\]]+)\]/g, '$1');
  }

  /**
   * Strips kanji leaving kana only
   */
  public static renderKanaOnly(text: string): string {
    if (!text) return '';
    return text.replace(/(?:^|\s*)([^\s\[\]]+)\[([^\]]+)\]/g, '$2');
  }

  /**
   * Evaluates a Card Template against a Note's field values with full HTML support
   */
  public static renderTemplate(
    templateHtml: string,
    fields: Record<string, string>,
    isBack: boolean,
    frontHtmlRendered?: string,
    clozeOrd = 1
  ): string {
    let result = templateHtml || '';

    // 1. Support {{FrontSide}} on the back template
    if (isBack && frontHtmlRendered) {
      result = result.replace(/\{\{FrontSide\}\}/gi, frontHtmlRendered);
    } else {
      // On front, if someone accidentally places {{FrontSide}}, remove it
      result = result.replace(/\{\{FrontSide\}\}/gi, '');
    }

    // 2. Conditionals: {{#FieldName}}content{{/FieldName}}
    for (const [name, val] of Object.entries(fields)) {
      const hasContent = val && val.trim().length > 0;
      const condRegex = new RegExp(`\\{\\{#${name}\\}\\}([\\s\\S]*?)\\{\\{/${name}\\}`, 'g');
      result = result.replace(condRegex, hasContent ? '$1' : '');

      // Inverted conditionals: {{^FieldName}}content{{/FieldName}}
      const invRegex = new RegExp(`\\{\\{\\^${name}\\}\\}([\\s\\S]*?)\\{\\{/${name}\\}`, 'g');
      result = result.replace(invRegex, !hasContent ? '$1' : '');
    }

    // 3. Filter {{cloze:FieldName}}
    result = result.replace(/\{\{cloze:([^}]+)\}\}/g, (_m, fieldName) => {
      const val = fields[fieldName.trim()] || '';
      return isBack
        ? this.renderClozeBack(val, clozeOrd)
        : this.renderClozeFront(val, clozeOrd);
    });

    // 4. Filter {{furigana:FieldName}}
    result = result.replace(/\{\{furigana:([^}]+)\}\}/gi, (_m, fieldName) => {
      const val = fields[fieldName.trim()] || '';
      return this.renderFurigana(val);
    });

    // 5. Filter {{kanji:FieldName}}
    result = result.replace(/\{\{kanji:([^}]+)\}\}/gi, (_m, fieldName) => {
      const val = fields[fieldName.trim()] || '';
      return this.renderKanjiOnly(val);
    });

    // 6. Filter {{kana:FieldName}}
    result = result.replace(/\{\{kana:([^}]+)\}\}/gi, (_m, fieldName) => {
      const val = fields[fieldName.trim()] || '';
      return this.renderKanaOnly(val);
    });

    // 7. Filter {{hint}} and {{hint:FieldName}}
    result = result.replace(/\{\{hint\}\}/gi, () => {
      let val = '';
      for (const [k, v] of Object.entries(fields)) {
        const lower = k.toLowerCase().trim();
        if (lower === 'hint' || lower === 'dica') {
          val = v;
          break;
        }
      }
      if (!val) {
        val = fields['Hint'] || fields['hint'] || fields['Dica'] || fields['dica'] || '';
      }
      if (!val || !val.trim()) return '';
      return `<details class="runora-hint-details group my-2.5 inline-block text-left select-none rounded-2xl bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/20 text-amber-900 dark:text-amber-200 transition-all">
        <summary class="cursor-pointer font-semibold text-xs py-2 px-3.5 flex items-center gap-1.5 text-amber-700 dark:text-amber-400 hover:opacity-90 outline-none list-none [&::-webkit-details-marker]:hidden">
          <span>💡</span>
          <span>Show Hint</span>
        </summary>
        <div class="px-3.5 pb-2.5 pt-1.5 text-xs text-zinc-800 dark:text-zinc-200 border-t border-amber-500/15 font-normal leading-relaxed opacity-95">
          ${val}
        </div>
      </details>`;
    });

    result = result.replace(/\{\{hint:([^}]+)\}\}/gi, (_m, fieldName) => {
      const trimmedName = fieldName.trim();
      const val = fields[trimmedName] || '';
      if (!val) return '';
      const label = trimmedName.toLowerCase() === 'hint' ? 'Show Hint' : `Show Hint: ${trimmedName}`;
      return `<details class="runora-hint-details group my-2.5 inline-block text-left select-none rounded-2xl bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/20 text-amber-900 dark:text-amber-200 transition-all">
        <summary class="cursor-pointer font-semibold text-xs py-2 px-3.5 flex items-center gap-1.5 text-amber-700 dark:text-amber-400 hover:opacity-90 outline-none list-none [&::-webkit-details-marker]:hidden">
          <span>💡</span>
          <span>${label}</span>
        </summary>
        <div class="px-3.5 pb-2.5 pt-1.5 text-xs text-zinc-800 dark:text-zinc-200 border-t border-amber-500/15 font-normal leading-relaxed opacity-95">
          ${val}
        </div>
      </details>`;
    });

    // 8. Filter {{text:FieldName}} (strip HTML tags)
    result = result.replace(/\{\{text:([^}]+)\}\}/gi, (_m, fieldName) => {
      const val = fields[fieldName.trim()] || '';
      return val.replace(/<[^>]*>?/gm, '');
    });

    // 9. Replace {{voice:record}} and {{voice:reproduce}}
    result = result.replace(/\{\{voice:record\}\}/gi, VOICE_RECORD_SLOT);
    result = result.replace(/\{\{voice:reproduce\}\}/gi, VOICE_REPRODUCE_SLOT);

    // 10. Replace standard {{FieldName}}
    for (const [name, val] of Object.entries(fields)) {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\{\\{${escapedName}\\}\\}`, 'g');

      // Format media within the field value ([sound:...], audio urls, images)
      const formattedValue = this.formatMediaContent(val || '');

      result = result.replace(pattern, formattedValue);
    }

    // Also format media in the final result in case tags were in templates
    result = this.formatMediaContent(result);

    // Clean any remaining unmapped {{FieldName}} tags that weren't in fields dictionary
    result = result.replace(/\{\{[^}]+\}\}/g, '');

    // Normalize malformed HTML exactly like a browser does (cards render in
    // a full document, so unclosed tables etc. still display). Without this,
    // deck templates authored with broken tag nesting lose content in React.
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(`<body>${result}</body>`, 'text/html');
      result = doc.body.innerHTML;
    }

    return result;
  }

  /**
   * Formats media tags ([sound:...], raw audio URLs, raw image URLs) into playable HTML elements
   */
  public static formatMediaContent(content: string): string {
    if (!content) return '';

    let formatted = content;

    // 1. Replace [sound:URL] with <audio autoplay> — [sound:] plays automatically
    // unless the deck option disables autoplay (handled downstream by CardContentRenderer)
    formatted = formatted.replace(
      /\[sound:([^\]]+)\]/gi,
      (_match, url) => `<audio controls autoplay src="${url.trim()}" class="my-2 max-w-full h-9 rounded-xl"></audio>`
    );

    // 2. Replace standalone TTSMaker and audio URLs not already inside an audio tag
    // Match URLs ending in .mp3, .wav, .ogg, .m4a, or containing ttsmaker-file
    formatted = formatted.replace(
      /(?<!src=["'])(https?:\/\/[^\s<>"']*(?:ttsmaker-file\.com[^\s<>"']*|\.(?:mp3|wav|ogg|m4a|aac|opus)(?:\?[^\s<>"']*)?))/gi,
      (_match, url) => `<audio controls autoplay src="${url.trim()}" class="my-2 max-w-full h-9 rounded-xl"></audio>`
    );

    // 3. Replace standalone image URLs not already inside an img tag
    formatted = formatted.replace(
      /(?<!src=["'])(https?:\/\/[^\s<>"']+\.(?:png|jpe?g|webp|gif|svg|avif)(?:\?[^\s<>"']*)?)/gi,
      (_match, url) => `<img src="${url.trim()}" alt="Image" class="rounded-xl max-h-64 mx-auto my-2 shadow-sm" />`
    );

    return formatted;
  }
}
