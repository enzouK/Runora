/**
 * noteIdentity — identidade universal das notas.
 *
 * Cada nota carrega um `guid` ("RG" universal) que a torna reconhecível
 * entre dispositivos, exportações e sincronizações:
 * - Notas criadas no Runora recebem um GUID gerado no ato da criação.
 * - Notas importadas do Anki carregam o GUID do próprio Anki (a regra que
 *   o Anki usa para reimportar sem duplicar).
 * - Notas antigas (sem GUID) recebem um no backfill automático: na abertura
 *   do app, ao exportar e ao importar.
 *
 * O GUID é a identidade PRIMÁRIA. Quando um lado ainda não tem GUID (base
 * antiga, arquivo externo), a assinatura por CONTEÚDO serve como
 * reconhecimento de reserva: tipo de nota + deck + valores dos campos
 * normalizados. Assim uma mesma nota, mesmo criada em aparelhos
 * diferentes, é reconhecida como "a mesma".
 */
import type { Note } from '../types/runora';

/** Gera um GUID universal (UUID) para uma nota nova do Runora. */
export function generateGuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback determinístico em ambientes sem crypto.randomUUID
  return `guid-${Date.now().toString(16)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** True quando a nota já tem um GUID utilizável. */
export function hasGuid(note: Note | undefined | null): boolean {
  return !!note?.guid && note.guid.trim().length > 0;
}

/**
 * Normaliza o texto de um campo para comparação por conteúdo:
 * remove etiquetas HTML (comparar `<b>gato</b>` com `gato`),
 * des-escapa entidades comuns e colapsa espaços em branco.
 * NÃO altera maiúsculas/minúsculas — ali é conteúdo de verdade.
 */
export function normalizeFieldValue(value: string): string {
  return (value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** FNV-1a 32-bit — hash pequeno e estável para a assinatura. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Assinatura por conteúdo de uma nota: reconhecimento de reserva quando o
 * GUID não existe dos dois lados. Inclui o NOME do tipo de nota e do deck
 * (os nomes sobrevivem entre dispositivos — ids não) e os valores dos
 * campos normalizados, em ordem determinística.
 */
export function computeNoteSignature(
  note: Note,
  noteTypeName: string,
  deckName: string
): string {
  const fieldEntries = Object.entries(note.fields || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${normalizeFieldValue(value)}`)
    // Campos vazios são ignorados: uma nota SEM o campo "Extra" e outra
    // com "Extra" em branco são a mesma nota, não notas diferentes.
    .filter((entry) => !entry.endsWith('='))
    .join('|');
  const payload = `v1|type:${noteTypeName}|deck:${deckName}|${fieldEntries}`;
  return `sig-${fnv1a(payload)}-${payload.length.toString(16)}`;
}

/**
 * Backfill: devolve a lista com todas as notas contendo GUID.
 * Quando nada muda, devolve a MESMA referência (barato de checar no
 * chamador: `ensured !== original`).
 */
export function ensureNoteGuids(notes: Note[]): Note[] {
  let changed = false;
  const out = notes.map((n) => {
    if (hasGuid(n)) return n;
    changed = true;
    return { ...n, guid: generateGuid() };
  });
  return changed ? out : notes;
}
