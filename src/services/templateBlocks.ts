/**
 * Blocos de campo e edição de CSS para o editor de templates.
 *
 * O app substitui `{{Campo}}` pelo valor CRU (sem elemento em volta), então
 * não dá para estilizar um campo isolado por CSS. Por isso a inserção cria
 * um bloco com classe própria:
 *
 *   <div class="runora-field runora-field--sentence">{{Sentence}}</div>
 *
 * Aí o CSS consegue mirar cada campo isoladamente:
 *   .runora-field--sentence { font-size: 24px; font-weight: 700; }
 */

/** Converte o nome do campo em um "slug" seguro para classe CSS. */
export const slugifyFieldName = (name: string): string => {
  const slug = (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'campo';
};

/**
 * Mapa nome do campo -> slug único.
 * Dois campos que geram o mesmo slug ("My Field" e "my-field") recebem
 * sufixo numérico, para as classes não colidirem.
 */
export const buildFieldSlugs = (fieldNames: string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const name of fieldNames) {
    const base = slugifyFieldName(name);
    let slug = base;
    let n = 2;
    while (used.has(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    used.add(slug);
    out[name] = slug;
  }
  return out;
};

/** Monta o bloco HTML de um campo. */
export const buildFieldBlock = (fieldName: string, slug: string): string =>
  `<div class="runora-field runora-field--${slug}">{{${fieldName}}}</div>`;

/**
 * Slug (classe CSS) de uma tag — vale tanto para os campos do tipo de
 * nota quanto para as tags especiais (hint, furigana:X, voice:record...).
 *
 * Campos usam o mapa com sufixo (nomes iguais não colidem); as tags
 * especiais usam o slug direto ("furigana:Reading" -> "furigana-reading",
 * "voice:record" -> "voice-record").
 */
export const tagCssSlug = (
  tag: string,
  fieldSlugs: Record<string, string> = {}
): string => {
  const nome = (tag || '').trim();
  const lower = nome.toLowerCase();
  const especial =
    lower === 'hint' ||
    /^(furigana|kanji|kana|cloze|hint):/i.test(nome) ||
    lower.startsWith('voice:');
  if (especial) return slugifyFieldName(nome);
  return fieldSlugs[nome] ?? slugifyFieldName(nome);
};

/** Seletor CSS da regra de um campo. */
export const fieldCssSelector = (slug: string): string => `.runora-field--${slug}`;

/** Seletor CSS da regra do card (mesmo seletor do Anki). */
export const CARD_CSS_SELECTOR = '.card';

/**
 * Monta a regra CSS de um campo (para a aba Estilo).
 *
 * A regra nasce só com o tamanho da fonte — nada de negrito, para o
 * campo não aparecer "em negrito" sem o usuário ter pedido.
 */
export const buildFieldCssRule = (slug: string): string =>
  `${fieldCssSelector(slug)} {\n` +
  `  font-size: 24px;\n` +
  `}`;

/**
 * Garante que o CSS tenha a regra de um campo — cria no fim do arquivo
 * se ainda não existir. Devolve o CSS (sem mudar nada se já existe).
 */
export const ensureFieldCssRule = (css: string, slug: string): string => {
  const current = css || '';
  if (hasCssRule(current, fieldCssSelector(slug))) return current;

  const regra = buildFieldCssRule(slug);
  const base = current.replace(/\s+$/, '');
  return base ? `${base}\n\n${regra}\n` : `${regra}\n`;
};

/* ---------- Edição das regras CSS ---------- */

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface RuleMatch {
  index: number;
  length: number;
  /** Texto do seletor + "{" */
  open: string;
  /** Declarações de dentro da regra */
  body: string;
  /** "}" */
  close: string;
}

/** Localiza a regra `seletor { ... }` dentro do CSS. */
const findRule = (css: string, selector: string): RuleMatch | null => {
  const re = new RegExp(`(${escapeRegex(selector)}\\s*\\{)([^}]*)(\\})`, 'm');
  const m = css.match(re);
  if (!m || m.index === undefined) return null;
  return {
    index: m.index,
    length: m[0].length,
    open: m[1],
    body: m[2],
    close: m[3],
  };
};

/** Verifica se o CSS já tem uma regra para aquele seletor. */
export const hasCssRule = (css: string, selector: string): boolean =>
  findRule(css || '', selector) !== null;

/** Verifica se o CSS já tem uma regra para aquele campo. */
export const hasFieldCssRule = (css: string, slug: string): boolean =>
  hasCssRule(css, fieldCssSelector(slug));

/** Lê o valor atual de uma propriedade dentro de uma regra. */
export const getCssProperty = (
  css: string,
  selector: string,
  property: string
): string | null => {
  const rule = findRule(css || '', selector);
  if (!rule) return null;
  const re = new RegExp(`^[ \\t]*${escapeRegex(property)}[ \\t]*:[ \\t]*([^;\\n]+);?`, 'm');
  const m = rule.body.match(re);
  return m ? m[1].trim() : null;
};

/** Define (ou troca) uma propriedade dentro de uma regra. */
export const setCssProperty = (
  css: string,
  selector: string,
  property: string,
  value: string
): string => {
  const decl = `${property}: ${value};`;
  const current = css || '';
  const rule = findRule(current, selector);

  // A regra ainda não existe: cria no fim do CSS
  if (!rule) {
    const nova = `${selector} {\n  ${decl}\n}`;
    const base = current.replace(/\s+$/, '');
    return base ? `${base}\n\n${nova}\n` : `${nova}\n`;
  }

  // Tira a propriedade antiga (se houver) e põe a nova no fim da regra
  const linhas = rule.body
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .filter((l) => !new RegExp(`^${escapeRegex(property)}[ \\t]*:`).test(l.trim()));

  const novoBody = [...linhas, `  ${decl}`].join('\n');
  const novaRegra = `${rule.open}\n${novoBody}\n${rule.close}`;

  return current.slice(0, rule.index) + novaRegra + current.slice(rule.index + rule.length);
};

/** Remove uma propriedade de dentro de uma regra. */
export const removeCssProperty = (css: string, selector: string, property: string): string => {
  const current = css || '';
  const rule = findRule(current, selector);
  if (!rule) return current;

  const antes = rule.body.split('\n').filter((l) => l.trim().length > 0);
  const linhas = antes.filter(
    (l) => !new RegExp(`^${escapeRegex(property)}[ \\t]*:`).test(l.trim())
  );
  if (linhas.length === antes.length) return current;

  const novoBody = linhas.join('\n');
  const novaRegra = linhas.length
    ? `${rule.open}\n${novoBody}\n${rule.close}`
    : `${rule.open}${rule.close}`;

  return current.slice(0, rule.index) + novaRegra + current.slice(rule.index + rule.length);
};

/**
 * Alterna uma propriedade: se ela já estiver com esse valor, remove;
 * senão, define (criando a regra se ainda não existir).
 */
export const toggleCssProperty = (
  css: string,
  selector: string,
  property: string,
  value: string
): string => {
  const atual = getCssProperty(css, selector, property);
  if (atual !== null && atual.toLowerCase() === value.toLowerCase()) {
    return removeCssProperty(css, selector, property);
  }
  return setCssProperty(css, selector, property, value);
};

/* ---------- Seletores no código CSS ---------- */

/**
 * Lista os slugs de campo que têm regra no CSS.
 * Ex.: ".runora-field--sentence { ... }" -> ["sentence"]
 */
export const cssFieldSelectors = (css: string): string[] => {
  const out: string[] = [];
  const re = /\.runora-field--([a-z0-9-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css || '')) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
};

/**
 * Descobre o seletor da regra CSS que está na posição do cursor.
 *
 * Serve para trocar o alvo da toolbar sozinho quando o usuário clica
 * no código de um campo (ou no .card).
 *
 * - Cursor em cima do nome do seletor (".runora-field--x {") -> esse seletor
 * - Cursor dentro das declarações ("font-size: 28px;") -> o seletor da regra
 *
 * @param pos posição do cursor no texto do CSS
 */
export const cssSelectorAt = (css: string, pos: number): string | null => {
  const texto = css || '';
  const limite = Math.max(0, Math.min(pos, texto.length));

  // ----- linha onde está o cursor -----
  const inicioLinha = texto.lastIndexOf('\n', limite - 1) + 1;
  const quebraLinha = texto.indexOf('\n', limite);
  const fimLinha = quebraLinha === -1 ? texto.length : quebraLinha;
  const linha = texto.slice(inicioLinha, fimLinha);
  const posNaLinha = limite - inicioLinha;
  const linhaSemComentario = linha.replace(/\/\*.*?\*\//g, '');

  // 1) cursor em cima de uma linha de seletor (antes da '{' da linha)
  const chave = linhaSemComentario.indexOf('{');
  if (chave >= 0 && posNaLinha <= chave) {
    const sel = linhaSemComentario.slice(0, chave).trim();
    if (sel && /[.#][\w-]/.test(sel)) return sel;
  }

  // 2) cursor dentro das declarações -> seletor da regra que o contém
  const ate = texto.slice(0, limite);
  let posChave = ate.lastIndexOf('{');
  // cursor exatamente na chave: conta a chave que está na posição
  if (posChave < 0 && texto[limite] === '{') posChave = limite;

  if (posChave >= 0) {
    // texto antes da chave = fim do seletor
    const antes = ate.slice(0, posChave);
    // o seletor começa depois da última regra fechada (ou depois de ';')
    const inicio = Math.max(antes.lastIndexOf('}'), antes.lastIndexOf(';')) + 1;
    const sel = antes
      .slice(inicio)
      .split('\n')
      .map((l) => l.replace(/\/\*.*?\*\//g, '').trim())
      .filter(Boolean)
      .join(' ')
      .trim();

    if (sel) return sel;
  }

  // 3) seletor escrito em várias linhas (ex.: ".card," numa linha e o
  //    nome do campo na linha seguinte)
  const selLinha = linhaSemComentario.split('{')[0].trim();
  if (selLinha && !selLinha.includes(';') && /[.#][\w-]/.test(selLinha)) {
    return selLinha;
  }

  return null;
};

/* ---------- Campos usados no HTML ---------- */

/**
 * Descobre se um campo é usado no HTML do template.
 * Procura `{{Campo}}` e também as tags com prefixo
 * ({{furigana:Campo}}, {{kanji:Campo}}, {{kana:Campo}}, {{cloze:Campo}}).
 */
export const templateUsesField = (html: string, fieldName: string): boolean => {
  if (!html || !fieldName) return false;
  const name = fieldName.trim();
  if (!name) return false;
  const escaped = escapeRegex(name);
  return new RegExp(
    `\\{\\{\\s*(?:furigana|kanji|kana|cloze|hint)?\\s*:?\\s*${escaped}\\s*\\}\\}`,
    'i'
  ).test(html);
};

/** Tags do Anki que o app entende e que podem ganhar uma regra de estilo. */
export const STYLEABLE_TAGS = [
  'hint',
  'voice:record',
  'voice:reproduce',
];

/**
 * Lista as tags "estilizáveis" que aparecem no HTML:
 * os campos do tipo de nota + as tags especiais (hint, furigana:X, ...).
 * Serve para mostrar na lista de alvos da aba Estilo (CSS).
 */
export const extractStyleableTags = (
  html: string,
  fieldNames: string[]
): string[] => {
  if (!html) return [];

  const found = new Set<string>();
  const nomes = new Set(fieldNames.map((n) => n.trim().toLowerCase()));

  // Tags {{...}} do HTML
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[1].trim();
    if (!tag) continue;

    const tagLower = tag.toLowerCase();

    // Campo do tipo de nota
    if (nomes.has(tagLower)) {
      found.add(tag);
      continue;
    }

    // hint
    if (tagLower === 'hint') {
      found.add(tag);
      continue;
    }

    // furigana:Campo / kanji:Campo / kana:Campo / cloze:Campo / hint:Campo
    const withField = /^(furigana|kanji|kana|cloze|hint):(.+)$/i.exec(tag);
    if (withField) {
      found.add(tag);
      continue;
    }

    // voice:record / voice:reproduce
    if (STYLEABLE_TAGS.includes(tagLower) && tagLower.startsWith('voice:')) {
      found.add(tag);
    }
  }

  return [...found];
};

