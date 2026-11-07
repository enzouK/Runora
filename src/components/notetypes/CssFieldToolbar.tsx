import React from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Underline,
} from 'lucide-react';
import { IOSSelect, IOSSelectOption } from '../common/IOSSelect';
import { Popover } from './Popover';
import { getCssProperty } from '../../services/templateBlocks';

export interface CssTarget {
  /** Identificador interno (nome do campo ou "card"). */
  id: string;
  /** Texto mostrado no dropdown. */
  label: string;
  /** Seletor CSS da regra (ex.: ".runora-field--sentence" ou ".card"). */
  selector: string;
}

interface CssFieldToolbarProps {
  /** Onde a formatação vai ser aplicada (campos + card). */
  targets: CssTarget[];
  /** Alvo atual. */
  targetId: string;
  /** Troca o alvo. */
  onSelectTarget: (id: string) => void;
  /** CSS atual do tipo de nota (para marcar o que já está ativo). */
  css: string;
  /** Seletor CSS do alvo atual. */
  selector: string;
  /** Se o alvo atual é o card (mostra as opções extras). */
  isCard: boolean;
  /** Aplica a formatação (toggle: clicar de novo remove). */
  onApply: (property: string, value: string, toggle?: boolean) => void;
}

/** Tamanhos de fonte (lista contínua, como no Word). */
const FONT_SIZES = [
  8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 30, 32, 36, 40, 44, 48, 56, 64,
  72, 80, 96,
];

/** Fontes mais usadas. */
const FONT_FAMILIES: IOSSelectOption[] = [
  { value: 'Arial', label: 'Arial' },
  { value: 'Helvetica', label: 'Helvetica' },
  { value: 'Verdana', label: 'Verdana' },
  { value: 'Tahoma', label: 'Tahoma' },
  { value: 'Georgia', label: 'Georgia' },
  { value: '"Times New Roman"', label: 'Times New Roman' },
  { value: '"Courier New"', label: 'Courier New' },
  { value: 'sans-serif', label: 'sans-serif' },
  { value: 'serif', label: 'serif' },
  { value: 'monospace', label: 'monospace' },
];

/** Cores da paleta. */
const PALETTE = [
  { value: '#000000', label: 'Preto' },
  { value: '#ffffff', label: 'Branco' },
  { value: '#71717a', label: 'Cinza' },
  { value: '#dc2626', label: 'Vermelho' },
  { value: '#ea580c', label: 'Laranja' },
  { value: '#ca8a04', label: 'Amarelo' },
  { value: '#16a34a', label: 'Verde' },
  { value: '#0891b2', label: 'Ciano' },
  { value: '#2563eb', label: 'Azul' },
  { value: '#7c3aed', label: 'Roxo' },
  { value: '#db2777', label: 'Rosa' },
  { value: '#fef3c7', label: 'Creme' },
  { value: '#dcfce7', label: 'Verde claro' },
  { value: '#dbeafe', label: 'Azul claro' },
  { value: '#fee2e2', label: 'Vermelho claro' },
  { value: '#f4f4f5', label: 'Cinza claro' },
];

const CARD_WIDTHS: IOSSelectOption[] = [
  { value: 'auto', label: 'Automático' },
  { value: '100%', label: '100%' },
  { value: '90%', label: '90%' },
  { value: '75%', label: '75%' },
  { value: '600px', label: '600px' },
  { value: '480px', label: '480px' },
  { value: '360px', label: '360px' },
];

const CARD_HEIGHTS: IOSSelectOption[] = [
  { value: 'auto', label: 'Automático' },
  { value: '600px', label: '600px' },
  { value: '450px', label: '450px' },
  { value: '300px', label: '300px' },
  { value: '200px', label: '200px' },
];

const btn =
  'flex items-center justify-center w-7 h-7 rounded-lg text-zinc-500 hover:text-zinc-900 hover:bg-white dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors';

const btnAtivo =
  'flex items-center justify-center w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 transition-colors';

const sep = 'w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1';

/**
 * Toolbar de formatação do CSS (aba Estilo).
 *
 * Toda a formatação dos campos passa por aqui: o usuário escolhe o alvo
 * (um campo ou o card) e clica no formato — a regra CSS do alvo é criada
 * ou atualizada. Nada de `style="..."` inline no HTML, então o CSS do
 * tipo de nota continua sendo a única fonte de verdade (igual no Anki).
 */
export const CssFieldToolbar: React.FC<CssFieldToolbarProps> = ({
  targets,
  targetId,
  onSelectTarget,
  css,
  selector,
  isCard,
  onApply,
}) => {
  if (targets.length === 0) return null;

  /** Valor atual de uma propriedade do alvo. */
  const current = (property: string) => getCssProperty(css, selector, property);

  const negritoAtivo = (() => {
    const v = current('font-weight');
    return v !== null && /^(bold|[6-9]00)$/i.test(v.trim());
  })();
  const italicoAtivo = (() => {
    const v = current('font-style');
    return v !== null && /italic/i.test(v);
  })();
  const sublinhadoAtivo = (() => {
    const v = current('text-decoration');
    return v !== null && /underline/i.test(v);
  })();
  const alinhamento = current('text-align')?.trim();
  const tamanhoAtual = current('font-size')?.trim();
  const fonteAtual = current('font-family')?.trim();
  const corAtual = current('color')?.trim();
  const fundoAtual = current('background-color')?.trim();
  const larguraAtual = current('width')?.trim();
  const alturaAtual = current('height')?.trim();

  const targetOptions: IOSSelectOption[] = targets.map((t) => ({
    value: t.id,
    label: t.label,
  }));

  const sizeOptions: IOSSelectOption[] = FONT_SIZES.map((s) => ({
    value: `${s}px`,
    label: `${s}px`,
  }));

  /** Paleta de cores (com a opção de voltar ao padrão). */
  const colorGrid = (
    value: string | null | undefined,
    onPick: (v: string) => void,
    onReset: () => void
  ) => (
    <div className="grid grid-cols-4 gap-1.5">
      <button
        type="button"
        onClick={onReset}
        className="h-7 rounded-lg border border-zinc-200 dark:border-zinc-700 text-[10px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        title="Usar o padrão (herdado do .card)"
      >
        Padrão
      </button>
      {PALETTE.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onPick(c.value)}
          title={c.label}
          className={`h-7 rounded-lg border transition-transform hover:scale-105 ${
            value?.toLowerCase() === c.value
              ? 'ring-2 ring-blue-500 border-blue-500'
              : 'border-zinc-200 dark:border-zinc-700'
          }`}
          style={{ backgroundColor: c.value }}
        />
      ))}
    </div>
  );

  return (
    <div className="px-3 py-1.5 border-b border-zinc-200/80 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 flex flex-wrap items-center gap-1.5">
      {/* Alvo: campo ou card */}
      <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">Alvo:</span>
      <IOSSelect
        options={targetOptions}
        value={targetId}
        onChange={onSelectTarget}
        placeholder="Escolher"
        className="min-w-[130px]"
      />

      <span className={sep} />

      <button
        type="button"
        title="Negrito"
        onClick={() => onApply('font-weight', 'bold')}
        className={negritoAtivo ? btnAtivo : btn}
      >
        <Bold className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Itálico"
        onClick={() => onApply('font-style', 'italic')}
        className={italicoAtivo ? btnAtivo : btn}
      >
        <Italic className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Sublinhado"
        onClick={() => onApply('text-decoration', 'underline')}
        className={sublinhadoAtivo ? btnAtivo : btn}
      >
        <Underline className="w-3.5 h-3.5" />
      </button>

      <span className={sep} />

      <button
        type="button"
        title="Alinhar à esquerda"
        onClick={() => onApply('text-align', 'left')}
        className={alinhamento === 'left' ? btnAtivo : btn}
      >
        <AlignLeft className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Centralizar"
        onClick={() => onApply('text-align', 'center')}
        className={alinhamento === 'center' ? btnAtivo : btn}
      >
        <AlignCenter className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        title="Alinhar à direita"
        onClick={() => onApply('text-align', 'right')}
        className={alinhamento === 'right' ? btnAtivo : btn}
      >
        <AlignRight className="w-3.5 h-3.5" />
      </button>

      <span className={sep} />

      {/* Tamanho do texto (lista contínua, como no Word) */}
      <IOSSelect
        options={sizeOptions}
        value={tamanhoAtual && tamanhoAtual.endsWith('px') ? tamanhoAtual : ''}
        onChange={(v) => onApply('font-size', v, false)}
        placeholder="Tamanho"
        maxMenuHeight={280}
        className="min-w-[86px]"
      />

      {/* Tipo de fonte */}
      <IOSSelect
        options={FONT_FAMILIES}
        value={fonteAtual || ''}
        onChange={(v) => onApply('font-family', v, false)}
        placeholder="Fonte"
        maxMenuHeight={280}
        className="min-w-[120px]"
      />

      {/* Cor do texto */}
      <Popover
        title="Cor do texto"
        width={196}
        triggerClassName="flex items-center gap-1.5 h-7 px-2 rounded-lg text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800 transition-colors"
        trigger={
          <>
            <span
              className="w-3.5 h-3.5 rounded-full border border-zinc-300 dark:border-zinc-600"
              style={{
                backgroundColor: corAtual || 'transparent',
                backgroundImage: corAtual ? undefined : 'linear-gradient(45deg, #dc2626 50%, transparent 50%)',
              }}
            />
            <span>Cor</span>
          </>
        }
      >
        {(close) =>
          colorGrid(
            corAtual,
            (v) => {
              onApply('color', v, false);
              close();
            },
            () => {
              onApply('color', '', false);
              close();
            }
          )
        }
      </Popover>

      {/* Opções que só existem para o card */}
      {isCard && (
        <>
          <span className={sep} />

          <Popover
            title="Cor de fundo do card"
            width={196}
            triggerClassName="flex items-center gap-1.5 h-7 px-2 rounded-lg text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-white dark:hover:bg-zinc-800 transition-colors"
            trigger={
              <>
                <span
                  className="w-3.5 h-3.5 rounded-full border border-zinc-300 dark:border-zinc-600"
                  style={{ backgroundColor: fundoAtual || 'transparent' }}
                />
                <span>Fundo</span>
              </>
            }
          >
            {(close) =>
              colorGrid(
                fundoAtual,
                (v) => {
                  onApply('background-color', v, false);
                  close();
                },
                () => {
                  onApply('background-color', '', false);
                  close();
                }
              )
            }
          </Popover>

          <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
            Largura:
          </span>
          <IOSSelect
            options={CARD_WIDTHS}
            value={larguraAtual || ''}
            onChange={(v) => onApply('width', v, false)}
            placeholder="auto"
            className="min-w-[90px]"
          />

          <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">Altura:</span>
          <IOSSelect
            options={CARD_HEIGHTS}
            value={alturaAtual || ''}
            onChange={(v) => onApply('height', v, false)}
            placeholder="auto"
            className="min-w-[90px]"
          />
        </>
      )}
    </div>
  );
};
