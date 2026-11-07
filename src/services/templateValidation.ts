/**
 * templateValidation — validação de templates de card antes de salvar.
 *
 * Encontra problemas que fazem o card não aparecer direito no estudo:
 * - Campos citados no template que não existem no Note Type
 *   ({{Campus}} → texto some silenciosamente do card)
 * - HTML desbalanceado (<div> não fechada, </span> sem abertura...)
 * - CSS com chaves/comentários sem fechar
 *
 * Validar não BLOQUEIA o salvamento: o usuário decide salvar do mesmo jeito.
 */

/**
 * Tags do template que o renderizador resolve e NÃO são campos do Note Type.
 * (Tudo em minúsculas, sem o conteúdo depois de ":")
 */
const SPECIAL_TAGS = new Set([
  'frontside',
  'backside',
  'cloze',
  'hint',
  'furigana',
  'kanji',
  'kana',
  'voice',
]);

/** Elementos que não precisam de fechamento em HTML. */
const VOID_TAGS = new Set([
  'br','hr','img','input','meta','link','area','base','col','embed','source','track','wbr',
]);

/** Campos citados no template que não existem no Note Type. */
export const findUnknownFields = (
  templateHtml: string,
  fieldNames: string[]
): string[] => {
  if (!templateHtml) return [];
  const issues: string[] = [];
  const seen = new Set<string>();
  const push = (msg: string, chave: string) => {
    if (seen.has(chave)) return;
    seen.add(chave);
    issues.push(msg);
  };

  const re = /\{\{\s*([\s\S]{1,90}?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(templateHtml)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    // condicionais e fechamentos: {{#X}}, {{/X}}, {{^X}}
    if (/^[#/\^]/.test(raw)) continue;
    // sintaxe de cloze escrita direto: {{c1::texto}}
    if (raw.includes('::')) continue;

    const doisPontos = raw.indexOf(':');
    const nome = doisPontos === -1 ? raw : raw.slice(0, doisPontos);
    const arg = doisPontos === -1 ? null : raw.slice(doisPontos + 1);
    const especial = SPECIAL_TAGS.has(nome.toLowerCase());

    if (especial) {
      if (nome.toLowerCase() === 'voice') {
        // {{voice:record}} e {{voice:reproduce}} — qualquer outra coisa é
        // erro de digitação e some do card
        const cmd = (arg || '').trim().toLowerCase();
        if (cmd === 'record' || cmd === 'reproduce') continue;
        push(
          `{{${raw}}} inválido — use {{voice:record}} ou {{voice:reproduce}}`,
          raw
        );
        continue;
      }
      // cloze:, hint:, furigana:, kanji:, kana: recebem um CAMPO — valida
      // o nome (com erro de digitação o texto simplesmente não aparece)
      if (arg === null || !arg.trim()) continue; // {{hint}} sem campo é aceito
      if (fieldNames.includes(arg.trim())) continue;
      push(`Campo {{${raw}}} não existe neste tipo de nota.`, raw);
      continue;
    }

    // Prefixo com ":" que não é tag especial — {{hitnt:Frase}}, {{voicce:record}}...
    // O renderizador descarta essas tags e o conteúdo desaparece do card.
    if (doisPontos !== -1 && !especial) {
      push(`Tag {{${raw}}} não é reconhecida.`, raw);
      continue;
    }

    // campo comum: comparação EXATA (sem sugerir grafia)
    if (!/^[a-zA-ZÀ-ÿ0-9_ -.]+$/.test(raw)) continue;
    if (fieldNames.includes(raw)) continue;
    push(`Campo {{${raw}}} não existe neste tipo de nota.`, raw);
  }

  return issues;
};

/** Problemas de HTML desbalanceado (tag aberta sem fechar, fechamento a mais, pares trocados). */
export const findHtmlIssues = (templateHtml: string): string[] => {
  if (!templateHtml) return [];
  let html = templateHtml;

  // comentários de HTML não participam do balanceamento
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  // conteúdo de script/style não precisa fechar tags internamente
  html = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');

  const counts = new Map<string, number>();
  const promote = (msg: string) => {
    counts.set(msg, (counts.get(msg) || 0) + 1);
  };

  const stack: string[] = [];
  const autoClosed = new Map<string, number>();
  const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html)) !== null) {
    last = TAG_RE.lastIndex;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const selfClosed = m[3] === '/' || VOID_TAGS.has(tag);
    if (closing) {
      if (stack[stack.length - 1] === tag) {
        stack.pop();
      } else if (stack.includes(tag)) {
        // o navegador fecha automaticamente as pendentes — não é erro.
        // Guarda as tags fechadas por ele: o fechamento delas que aparecer
        // depois (fora de ordem) também não é erro.
        while (stack.length) {
          const aberta = stack.pop();
          if (aberta === undefined || aberta === tag) break;
          autoClosed.set(aberta, (autoClosed.get(aberta) || 0) + 1);
        }
      } else if ((autoClosed.get(tag) || 0) > 0) {
        autoClosed.set(tag, (autoClosed.get(tag) || 0) - 1);
      } else {
        promote(`</${tag}> sem a abertura correspondente`);
      }
    } else if (!selfClosed) {
      stack.push(tag);
    }
  }

  // tag começada que nem termina em ">" (rótulo de atributo aberto no fim)
  const rest = html.slice(last);
  if (/<[a-zA-Z][^>]*$/.test(rest)) {
    promote('Tag incompleta (falta o ">" no fim)');
  }
  for (const tag of stack) promote(`Tag <${tag}> não fechada`);

  return Array.from(counts.entries()).map(([msg, n]) =>
    n > 1 ? `${msg} (${n}x)` : msg
  );
};

/** Problemas de CSS (chaves ou comentário sem fechar). */
export const findCssIssues = (css: string): string[] => {
  if (!css || !css.trim()) return [];
  const issues: string[] = [];

  const abre = (css.match(/\{/g) || []).length;
  const fecha = (css.match(/\}/g) || []).length;
  if (abre > fecha) issues.push('Chave { sem a correspondente }');
  if (fecha > abre) issues.push(`Chave } a mais (${fecha - abre}x)`);

  if (!css.includes('*/') && (css.match(/\/\*/g) || []).length > 0) {
    issues.push('Comentário do CSS (/*) sem fechar');
  }

  return issues;
};

/**
 * Roda todas as validações e devolve a lista de problemas no formato
 * "Card 1 — problema". Lista vazia = templates saudáveis.
 */
export const validateTemplates = (
  templates: { name: string; qfmt: string; afmt: string }[],
  css: string,
  fieldNames: string[]
): string[] => {
  const issues: string[] = [];

  templates.forEach((t) => {
    for (const [aba, html] of [
      ['frente', t.qfmt],
      ['verso', t.afmt],
    ] as const) {
      findUnknownFields(html, fieldNames).forEach((i) =>
        issues.push(`${t.name} (${aba}) — ${i}`)
      );
      findHtmlIssues(html).forEach((i) =>
        issues.push(`${t.name} (${aba}) — ${i}`)
      );
    }
  });

  findCssIssues(css).forEach((i) => issues.push(`CSS — ${i}`));

  return issues;
};
