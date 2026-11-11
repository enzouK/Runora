import React from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { useBodyScrollLock } from '../common/useBodyScrollLock';
import type { SyncProgressState, SyncTally } from '../../services/gdriveSync';

interface Props {
  progress: SyncProgressState | null;
}

const PART_LABEL: Record<string, string> = {
  notes: 'notas',
  cards: 'cards',
  decks: 'decks',
  deletes: 'itens removidos',
  settings: 'configurações',
  media: 'arquivos de mídia',
  addons: 'extensões',
};

const ZERO_TALLY: SyncTally = { addedUp: 0, addedDown: 0, removedUp: 0, removedDown: 0 };

/**
 * Painel de progresso da sincronização — estilo Anki.
 *
 * Mostra contadores ao vivo ↑↓ (↑ enviado daqui · ↓ recebido da nuvem),
 * acumulados desde o início do sync, e o contador de ITENS por parte
 * (notas, cards, mídia) — nunca bytes. Sem "etapas": os números contam
 * a história, como na janela de sync do Anki.
 */
export const SyncProgressPanel: React.FC<Props> = ({ progress }) => {
  useBodyScrollLock(!!progress);
  if (!progress) return null;

  const { part, done, total, counts, tally } = progress;
  const t = tally ?? ZERO_TALLY;
  const hasCounter = !!part && (total ?? 0) > 0;
  const percent = hasCounter ? Math.min(100, Math.round(((done ?? 0) / (total ?? 1)) * 100)) : 0;

  // ── contador de ITENS por parte (linha pequena, só quando existe) ──
  // 1) o que está sendo processado agora ("30 de 38 notas")
  // 2) os totais da coleção que está sendo baixada/enviada ("81 notas, 81 cards")
  const pieces: string[] = [];
  if (hasCounter) {
    pieces.push(`${done ?? 0} de ${total} ${PART_LABEL[part!] ?? 'itens'}`);
  }
  if (counts && (counts.notes || counts.cards || counts.addons || counts.settings)) {
    const totalPieces: string[] = [];
    if (counts.notes) totalPieces.push(`${counts.notes} notas`);
    if (counts.cards) totalPieces.push(`${counts.cards} cards`);
    if (counts.settings) {
      totalPieces.push(counts.settings === 1 ? '1 configuração' : `${counts.settings} configurações`);
    }
    if (counts.addons) {
      totalPieces.push(counts.addons === 1 ? '1 extensão' : `${counts.addons} extensões`);
    }
    pieces.push(totalPieces.join(', '));
  }

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm animate-fade-in"
    >
      <div className="relative w-full max-w-sm bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl text-center">
        {/* Cards being dealt — the "working" cue */}
        <div className="flex items-end justify-center gap-2 h-20 mb-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="runora-card-deal w-12 h-16 rounded-xl border border-black/[0.08] dark:border-white/[0.12] bg-gradient-to-b from-white to-zinc-100 dark:from-zinc-800 dark:to-zinc-900 shadow-md flex items-center justify-center"
              style={{ animationDelay: `${i * 0.12}s` }}
            >
              <div
                className="runora-card-float w-7 h-9 rounded-md border border-ios-blue/25 bg-ios-blue/10"
                style={{ animationDelay: `${i * 0.25}s` }}
              />
            </div>
          ))}
        </div>

        <h3 className="text-[16px] font-bold text-zinc-900 dark:text-white">Sincronizando…</h3>

        {/* ── contadores ao vivo (estilo Anki: ↑ enviado daqui · ↓ recebido) ── */}
        <div className="mt-3 space-y-1 text-[14px] text-zinc-700 dark:text-zinc-300 tabular-nums">
          <p>
            Adicionados/Modificados: <span className="font-semibold">{t.addedUp}↑</span>{' '}
            <span className="font-semibold">{t.addedDown}↓</span>
          </p>
          <p>
            Removidos: <span className="font-semibold">{t.removedUp}↑</span>{' '}
            <span className="font-semibold">{t.removedDown}↓</span>
          </p>
        </div>

        {/* linha pequena de itens por parte ("12 de 81 notas") */}
        {pieces.length > 0 && (
          <p className="text-[12px] text-zinc-500 dark:text-zinc-400 mt-2 tabular-nums">
            {pieces.join(' · ')}
          </p>
        )}

        {/* Progress bar */}
        <div className="mt-4 h-2 w-full rounded-full bg-black/[0.07] dark:bg-white/[0.12] overflow-hidden">
          <div
            className={`h-full rounded-full bg-ios-blue transition-[width] duration-150 ease-out ${
              hasCounter ? 'runora-progress-shimmer' : 'runora-progress-indeterminate'
            }`}
            style={hasCounter ? { width: `${percent}%` } : undefined}
          />
        </div>

        <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
          <Loader2 className="w-3 h-3 animate-spin" />
        </div>
      </div>
    </div>,
    document.body
  );
};
