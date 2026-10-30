import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Download, RotateCcw, X } from 'lucide-react';
import { DeckService, DeckTreeNode } from '../../services/deckService';
import { StorageService } from '../../services/storage';
import { ExportImportService } from '../../services/exportImport';
import { AnkiApkgExportService } from '../../services/ankiApkgExport';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Square checkbox (Anki export-dialog style). */
const SqCheck: React.FC<{ checked: boolean; onChange: () => void; label: React.ReactNode }> = ({
  checked,
  onChange,
  label,
}) => (
  <button
    type="button"
    onClick={onChange}
    className="flex items-start gap-2.5 text-left group cursor-pointer"
  >
    <span
      className={`w-5 h-5 mt-0.5 rounded-[6px] shrink-0 flex items-center justify-center border-2 transition-colors ${
        checked
          ? 'bg-ios-blue border-ios-blue text-white'
          : 'bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-600 group-hover:border-ios-blue'
      }`}
    >
      {checked && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
    </span>
    <span className="text-[13px] text-zinc-700 dark:text-zinc-200 font-medium group-hover:text-zinc-900 dark:group-hover:text-white transition-colors">
      {label}
    </span>
  </button>
);

/** Deck row with its nested subdecks, one selectable checkbox each. */
const DeckNode: React.FC<{
  node: DeckTreeNode;
  checked: Set<string>;
  collapsed: Set<string>;
  onToggle: (node: DeckTreeNode, next: boolean) => void;
  onToggleCollapse: (id: string) => void;
}> = ({ node, checked, collapsed, onToggle, onToggleCollapse }) => {
  const isCollapsed = collapsed.has(node.deck.id);
  const hasChildren = node.children.length > 0;
  return (
    <>
      <div
        className="flex items-center gap-2.5 py-1.5 pr-3"
        style={{ paddingLeft: `${12 + node.level * 24}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleCollapse(node.deck.id)}
            className="p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            title={isCollapsed ? 'Expandir subdecks' : 'Recolher subdecks'}
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
            />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <SqCheck
          checked={checked.has(node.deck.id)}
          onChange={() => onToggle(node, !checked.has(node.deck.id))}
          label={node.shortName}
        />
        <span
          className="ml-auto text-[11px] font-semibold tabular-nums text-zinc-400 dark:text-zinc-500 shrink-0"
          title="Cards vencidos/pendentes neste deck"
        >
          {node.counts.newCount + node.counts.learningCount + node.counts.reviewCount}
        </span>
      </div>
      {hasChildren &&
        !isCollapsed &&
        node.children.map((child) => (
          <DeckNode
            key={child.deck.id}
            node={child}
            checked={checked}
            collapsed={collapsed}
            onToggle={onToggle}
            onToggleCollapse={onToggleCollapse}
          />
        ))}
    </>
  );
};

/**
 * Anki-style export dialog: pick decks (a checked parent selects its whole
 * subtree) and include scheduling / presets / media — then download a .colpkg.
 */
export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [includeScheduling, setIncludeScheduling] = useState(true);
  const [includePresets, setIncludePresets] = useState(true);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Export format: real Anki .apkg (official clients) or our internal .colpkg
  const [format, setFormat] = useState<'apkg' | 'colpkg'>('apkg');
  // Selection: null = every deck checked (reset on each open)
  const [selected, setSelected] = useState<Set<string> | null>(null);

  const decks = useMemo(() => (isOpen ? StorageService.getDecks() : []), [isOpen]);
  const deckTree = useMemo(() => DeckService.buildDeckTree(decks), [decks]);
  const checked = selected ?? new Set(decks.map((d) => d.id));

  // Fresh start on every open: all decks checked, options back to defaults
  useEffect(() => {
    if (!isOpen) return;
    setSelected(null);
    setCollapsed(new Set());
    setError(null);
    setBusy(false);
  }, [isOpen]);

  if (!isOpen) return null;

  /** Toggle a deck and its whole subtree, like Anki's export deck picker. */
  const toggleWithDescendants = (node: DeckTreeNode, next: boolean) => {
    setSelected(() => {
      const nextSet = new Set(checked);
      const walk = (n: DeckTreeNode) => {
        if (next) nextSet.add(n.deck.id);
        else nextSet.delete(n.deck.id);
        n.children.forEach(walk);
      };
      walk(node);
      return nextSet;
    });
  };

  const handleSelectAll = () => {
    const allIds = decks.map((d) => d.id);
    const allOn = allIds.every((id) => checked.has(id));
    setSelected(allOn ? new Set() : new Set(allIds));
  };

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const desktop = (window as unknown as { ankiDesktop?: AnkiDesktopBridge }).ankiDesktop;
      const opts = {
        deckIds: Array.from(checked),
        includeScheduling,
        includePresets,
        includeMedia,
      };
      const isApkg = format === 'apkg';

      if (desktop) {
        // Real desktop app: native Save As via IPC (works where the web
        // File System Access API is blocked, e.g. embedded Chromium).
        const ext = isApkg ? 'apkg' : 'colpkg';
        const pick = await desktop.pickSavePath(suggestedExportName(opts, isApkg), [
          { name: isApkg ? 'Anki Deck Package' : 'Anki 2.0 Coleção (FSRS)', extensions: [ext] },
        ]);
        if (pick.canceled || !pick.path) {
          setBusy(false);
          return; // user cancelled — nothing to do
        }
        const built = isApkg
          ? await AnkiApkgExportService.buildDeckPackage(opts)
          : await ExportImportService.buildCollectionPackage(opts);
        const res = await desktop.writeFile(pick.path, new Uint8Array(await built.blob.arrayBuffer()));
        if (!res.saved) {
          throw new Error(`a gravação nativa falhou: ${res.error || 'erro desconhecido'}`);
        }
        setSelected(null);
        onClose();
        return;
      }

      // Editor-embedded browsers (e.g. the OpenCode preview) let the save-as
      // dialog open but block the actual file write, leaving 0-byte orphans.
      // Fail fast: no dialog, no file, clear message.
      const isEmbeddedPreview = /OpenCode\//.test(navigator.userAgent);
      if (isEmbeddedPreview) {
        throw new Error(
          'não é possível exportar nesta plataforma (navegador embutido de ' +
            'preview bloqueia a gravação de arquivos). Nenhum arquivo foi gerado — ' +
            'abra o app em um Chrome/Edge normal para exportar.'
        );
      }

      // Ask where to save FIRST (still inside the click's user activation,
      // required by the File System Access API).
      let handle: SaveFileHandle | null = null;
      const picker = (window as unknown as {
        showSaveFilePicker?: (pickerOpts?: {
          suggestedName?: string;
          types?: Array<{ description?: string; accept: Record<string, string[]> }>;
        }) => Promise<SaveFileHandle>;
      }).showSaveFilePicker;
      // Top-level contexts only: sandboxed/preview iframes let the picker
      // open but block createWritable ("not allowed by the platform").
      const isTopLevel = window === window.top;
      if (picker && isTopLevel) {
        try {
          const suggestedName = suggestedExportName(opts, isApkg);
          handle = await picker.call(window, {
            suggestedName,
            types: [
              {
                description: isApkg ? 'Anki Deck Package' : 'Anki 2.0 Coleção (FSRS)',
                accept: { 'application/zip': [isApkg ? '.apkg' : '.colpkg'] },
              },
            ],
          });
        } catch (pickerErr) {
          if ((pickerErr as DOMException)?.name === 'AbortError') {
            setBusy(false);
            return; // user cancelled — nothing to do
          }
          console.warn('Save picker unavailable, will download instead:', pickerErr);
        }
      }

      const built = isApkg
        ? await AnkiApkgExportService.buildDeckPackage(opts) // official Anki package
        : await ExportImportService.buildCollectionPackage(opts); // internal restore package

      if (handle) {
        // A real save-as dialog ran: write the file where the user chose. If
        // the platform can't actually write there, report an error instead of
        // silently redirecting to a download the user doesn't expect.
        await writeBlobToHandle(handle, built.blob);
      } else {
        // No File System Access API at all (Firefox/Safari): the plain
        // download works there, so use it.
        ExportImportService.downloadBlob(built.blob, built.filename);
      }
      setSelected(null);
      onClose();
    } catch (err) {
      setError(`Falha ao exportar: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = checked.size;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="w-full max-w-md bg-ios-card dark:bg-ios-card-dark rounded-[20px] border border-black/[0.04] dark:border-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.25)] overflow-hidden flex flex-col max-h-[85vh] ios-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.05] dark:border-white/[0.07]">
          <div>
            <h3 className="text-[17px] font-bold text-zinc-900 dark:text-zinc-50">Exportar Decks</h3>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              Marcando o deck pai, todos os subdecks entram junto
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Export format (official .apkg or our internal .colpkg) */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-semibold text-zinc-700 dark:text-zinc-200">Formato de Exportação</p>
              <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {format === 'apkg'
                  ? 'Pacote Anki oficial — abre no desktop, AnkiDroid e AnkiMobile'
                  : 'Pacote interno com FSRS completo para restaurar neste app'}
              </p>
            </div>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'apkg' | 'colpkg')}
              className="shrink-0 max-w-[55%] px-3 py-2 rounded-[12px] bg-white dark:bg-zinc-900 border border-black/[0.08] dark:border-white/[0.12] text-[12px] font-semibold text-zinc-800 dark:text-zinc-100 focus:outline-none focus:border-ios-blue cursor-pointer"
            >
              <option value="apkg">Anki Deck Package (.apkg)</option>
              <option value="colpkg">Anki 2.0 Coleção (.colpkg)</option>
            </select>
          </div>

          {/* Deck tree */}
          <div className="rounded-[16px] border border-black/[0.06] dark:border-white/[0.08] divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            {deckTree.length === 0 ? (
              <p className="px-4 py-5 text-sm text-zinc-400 text-center">Nenhum deck na coleção.</p>
            ) : (
              deckTree.map((node) => (
                <DeckNode
                  key={node.deck.id}
                  node={node}
                  checked={checked}
                  collapsed={collapsed}
                  onToggle={toggleWithDescendants}
                  onToggleCollapse={(id) =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                />
              ))
            )}
          </div>

          {/* Include options (Anki export-dialog checkboxes) */}
          <div className="rounded-[16px] border border-black/[0.06] dark:border-white/[0.08] p-4 space-y-3.5">
            <SqCheck
              checked={includeScheduling}
              onChange={() => setIncludeScheduling((v) => !v)}
              label={
                <>
                  Incluir Informações de Agendamento
                  <span className="block text-[11px] font-normal text-zinc-400 dark:text-zinc-500">
                    Histórico de revisões e estado FSRS dos cards (revlog)
                  </span>
                </>
              }
            />
            <SqCheck
              checked={includePresets}
              onChange={() => setIncludePresets((v) => !v)}
              label={
                <>
                  Incluir Presets de Deck
                  <span className="block text-[11px] font-normal text-zinc-400 dark:text-zinc-500">
                    Folhas de opções usadas pelos decks selecionados
                  </span>
                </>
              }
            />
            <SqCheck
              checked={includeMedia}
              onChange={() => setIncludeMedia((v) => !v)}
              label={
                <>
                  Incluir Mídia
                  <span className="block text-[11px] font-normal text-zinc-400 dark:text-zinc-500">
                    Arquivos de áudio/imagem referenciados pelas notas
                  </span>
                </>
              }
            />
          </div>

          {error && (
            <p className="px-4 py-2.5 rounded-[12px] bg-red-500/10 text-[12px] text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2.5 px-5 py-4 border-t border-black/[0.05] dark:border-white/[0.07]">
          <button
            type="button"
            onClick={handleSelectAll}
            className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
            title={
              decks.length > 0 && selectedCount === decks.length
                ? 'Desmarcar todos'
                : 'Marcar todos'
            }
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-full text-[13px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={selectedCount === 0 || busy}
              className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-ios-blue hover:bg-[#0071eb] text-white font-semibold text-[13px] shadow-[0_2px_8px_rgba(0,122,255,0.35)] transition-all active:scale-95 disabled:opacity-50"
            >
              {busy && (
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              <Download className="w-3.5 h-3.5" />
              <span>Exportar{selectedCount > 0 ? ` (${selectedCount})` : ''}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── File System Access API types (not in the default DOM lib) ───────── */

/** Native bridge injected by our Electron preload (electron/preload.cjs). */
interface AnkiDesktopBridge {
  isDesktop: boolean;
  pickSavePath: (
    suggestedName: string,
    filters: Array<{ name: string; extensions: string[] }>
  ) => Promise<{ canceled: boolean; path?: string }>;
  writeFile: (path: string, bytes: Uint8Array) => Promise<{ saved: boolean; error?: string }>;
}

/** Package file name: real deck name for .apkg, dated for the internal .colpkg. */
function suggestedExportName(
  opts: { deckIds: string[] },
  isApkg: boolean
): string {
  return isApkg
    ? `${AnkiApkgExportService.pickFileName(opts)}.apkg`
    : `Anki2_Collection_FSRS_${new Date().toISOString().slice(0, 10)}.colpkg`;
}

interface SaveFileHandle {
  name?: string;
  createWritable: () => Promise<{
    write: (data: BlobPart) => Promise<void>;
    close: () => Promise<void>;
    abort?: () => Promise<void>;
  }>;
  getFile?: () => Promise<{ size: number }>;
  remove?: () => Promise<void>;
}

const WRITE_CHUNK = 8 * 1024 * 1024; // 8 MB slices — friendlier to stream sinks

/** Writes the blob (chunked) and verifies what actually landed on disk. */
async function writeBlobToHandle(handle: SaveFileHandle, blob: Blob): Promise<void> {
  let writable;
  try {
    writable = await handle.createWritable();
    if (blob.size <= WRITE_CHUNK) {
      await writable.write(blob);
    } else {
      for (let off = 0; off < blob.size; off += WRITE_CHUNK) {
        await writable.write(blob.slice(off, Math.min(off + WRITE_CHUNK, blob.size)));
      }
    }
    await writable.close();
  } catch (e) {
    try {
      await (writable?.abort ? writable.abort() : writable?.close());
    } catch {
      /* the underlying write already failed — nothing more to do */
    }
    // The platform may leave a 0-byte file behind after a failed write —
    // clean it up so the user doesn't import an empty package.
    try {
      await handle.remove?.();
    } catch {
      /* removing requires permission; best effort only */
    }
    throw e;
  }

  // Some browsers/embedded contexts accept createWritable but silently
  // produce empty files — verify the saved size before trusting it.
  let savedSize: number | null = null;
  try {
    const saved = await handle.getFile?.();
    savedSize = saved ? saved.size : null;
  } catch {
    // getFile itself being refused means we cannot trust the file at all.
    throw new Error('Não foi possível verificar o arquivo salvo nesta plataforma.');
  }
  if (savedSize !== null && savedSize !== blob.size) {
    try {
      await handle.remove?.();
    } catch {
      /* best effort only */
    }
    throw new Error(
      `O arquivo salvo ficou com ${(savedSize / 1048576).toFixed(1)} MB ` +
        `(esperado ${(blob.size / 1048576).toFixed(1)} MB)`
    );
  }
}
