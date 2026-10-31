import React, { useMemo, useState } from 'react';
import { Check, Download, X } from 'lucide-react';
import type { AddonManifest } from '../../services/addonSystem';
import { exportAddons } from '../../services/addonStorage';
import { ExportImportService } from '../../services/exportImport';

interface AddonExportModalProps {
  addons: AddonManifest[];
  onClose: () => void;
  onExported?: (message: string) => void;
}

interface AnkiDesktopBridge {
  isDesktop: boolean;
  pickSavePath: (
    suggestedName: string,
    filters: Array<{ name: string; extensions: string[] }>
  ) => Promise<{ canceled: boolean; path?: string }>;
  writeFile: (path: string, bytes: Uint8Array) => Promise<{ saved: boolean; error?: string }>;
  /** Native folder picker (Electron). Optional so older preloads still work. */
  pickDirectory?: (title?: string) => Promise<{ canceled: boolean; path?: string }>;
}

/** Minimal structural type for the web showDirectoryPicker handle. */
interface DirectoryPickerHandle {
  getFileHandle(name: string, opts: { create: boolean }): Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  }>;
}

/** Square checkbox (Runora export-dialog style) — box on the LEFT of the label. */
const SqCheck: React.FC<{ checked: boolean; onChange: () => void; label: React.ReactNode }> = ({
  checked,
  onChange,
  label,
}) => (
  <button type="button" onClick={onChange} className="flex items-center gap-2.5 text-left group cursor-pointer w-full">
    <span
      className={`w-5 h-5 rounded-[6px] shrink-0 flex items-center justify-center border-2 transition-colors ${
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

/**
 * Export dialog: lists installed addons with a checkbox on the left of each
 * row (plus "select all") and exports the chosen ones as a .anki2addon package
 * that includes each addon's config.json (the user's configured values).
 */
export const AddonExportModal: React.FC<AddonExportModalProps> = ({ addons, onClose, onExported }) => {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(addons.map((a) => a.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allIds = useMemo(() => addons.map((a) => a.id), [addons]);
  const allOn = allIds.length > 0 && allIds.every((id) => checked.has(id));

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => setChecked(allOn ? new Set() : new Set(allIds));

  const handleExport = async () => {
    const ids = allIds.filter((id) => checked.has(id));
    if (ids.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const desktop = (window as unknown as { ankiDesktop?: AnkiDesktopBridge }).ankiDesktop;

      // Ask WHERE to save FIRST (the web directory picker needs the click's
      // user activation, so it must run before any await-heavy work).
      let desktopDir: string | null = null;
      let webDir: DirectoryPickerHandle | null = null;
      if (desktop?.isDesktop && desktop.pickDirectory) {
        const pick = await desktop.pickDirectory('Escolher pasta para exportar os addons');
        if (pick.canceled || !pick.path) {
          setBusy(false);
          return; // user cancelled — nothing to do
        }
        desktopDir = pick.path;
      } else {
        const picker = (
          window as unknown as {
            showDirectoryPicker?: (opts?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<DirectoryPickerHandle>;
          }
        ).showDirectoryPicker;
        const isEmbeddedPreview = /OpenCode\//.test(navigator.userAgent);
        if (picker && window === window.top && !isEmbeddedPreview) {
          try {
            webDir = await picker.call(window, { id: 'anki2-addons-export', mode: 'readwrite' });
          } catch (pickerErr) {
            if ((pickerErr as DOMException)?.name === 'AbortError') {
              setBusy(false);
              return; // user cancelled the folder picker
            }
            webDir = null; // picker failed -> fall back to plain download
          }
        }
      }

      const built = await exportAddons(ids);
      const blob = new Blob([built.bytes.slice()], { type: 'application/zip' });

      if (desktopDir && desktop) {
        // Desktop: write <chosen folder>/<fileName> through the native bridge
        const sep = desktopDir.includes('\\') ? '\\' : '/';
        const res = await desktop.writeFile(`${desktopDir}${sep}${built.fileName}`, built.bytes);
        if (!res.saved) throw new Error(`a gravação nativa falhou: ${res.error || 'erro desconhecido'}`);
      } else if (webDir) {
        // Web with directory picker: write the file inside the chosen folder
        const fh = await webDir.getFileHandle(built.fileName, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
      } else {
        // Fallback (no picker available): plain download
        ExportImportService.downloadBlob(blob, built.fileName);
      }

      onExported?.(
        built.count === 1
          ? `Addon "${built.names[0]}" exportado como ${built.fileName}.`
          : `${built.count} addons exportados como ${built.fileName} (${built.names.join(', ')}).`
      );
      onClose();
    } catch (err) {
      setError(`Falha ao exportar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = checked.size;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      // onMouseDown (not onClick): a text-selection drag that starts inside the
      // modal and is released over the backdrop must NOT close it.
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="w-full max-w-md bg-white dark:bg-ios-card-dark rounded-[20px] border border-black/[0.04] dark:border-white/[0.06] shadow-[0_10px_40px_rgba(0,0,0,0.25)] overflow-hidden flex flex-col max-h-[85vh] ios-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.05] dark:border-white/[0.07]">
          <div>
            <h3 className="text-[17px] font-bold text-zinc-900 dark:text-zinc-50">Exportar Addons</h3>
            <p className="text-xs text-zinc-400 dark:text-zinc-500">
              O pacote inclui as configurações de cada addon (config.json)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="w-8 h-8 rounded-full flex items-center justify-center text-zinc-400 hover:bg-black/[0.06] dark:hover:bg-white/[0.1] hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body: addon list with left checkboxes */}
        <div className="flex-1 overflow-y-auto p-5">
          {addons.length === 0 ? (
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400 text-center py-6">
              Nenhum addon instalado para exportar.
            </p>
          ) : (
            <div className="rounded-[16px] border border-black/[0.06] dark:border-white/[0.08] divide-y divide-black/[0.05] dark:divide-white/[0.06]">
              <div className="p-3.5">
                <SqCheck checked={allOn} onChange={handleSelectAll} label={<span className="font-semibold">Selecionar todos ({addons.length})</span>} />
              </div>
              {addons.map((addon) => (
                <div key={addon.id} className="p-3.5">
                  <SqCheck
                    checked={checked.has(addon.id)}
                    onChange={() => toggle(addon.id)}
                    label={
                      <>
                        {addon.name}{' '}
                        <span className="text-[11px] font-normal text-zinc-400 dark:text-zinc-500 font-mono">
                          v{addon.version}
                        </span>
                        <span className="block text-[11px] font-normal text-zinc-400 dark:text-zinc-500">
                          {addon.id}
                          {addon.configSchema?.length ? ` · ${addon.configSchema.length} config(s)` : ''}
                        </span>
                      </>
                    }
                  />
                </div>
              ))}
            </div>
          )}
          {error && (
            <p className="mt-3 text-[12px] text-ios-red">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/[0.05] dark:border-white/[0.07]">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={busy || selectedCount === 0 || addons.length === 0}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-ios-blue hover:bg-[#0071eb] shadow-sm shadow-ios-blue/30 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
          >
            {busy ? (
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>Exportar{selectedCount > 0 ? ` (${selectedCount})` : ''}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
