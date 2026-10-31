import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings, X } from 'lucide-react';
import type { AddonConfigField, AddonManifest } from '../../services/addonSystem';
import { AddonSystem } from '../../services/addonSystem';
import { IOSSelect } from '../common/IOSSelect';
import { IOSSwitch } from '../common/IOSSwitch';

interface AddonConfigModalProps {
  /** Addon whose config is being edited (null = closed). */
  addon: AddonManifest | null;
  onClose: () => void;
  onSaved?: (message: string) => void;
}

const inputClass =
  'w-full px-3 py-2 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-[13px] text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-ios-blue/40 transition-shadow';

/**
 * Per-addon settings dialog. The form is generated automatically from the
 * addon's manifest `configSchema`; values are persisted to
 * Addons/<id>/config.json via AddonSystem.updateConfig (which also notifies
 * the addon's onConfigChange listeners).
 */
export const AddonConfigModal: React.FC<AddonConfigModalProps> = ({ addon, onClose, onSaved }) => {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  // Load current values whenever a different addon is opened
  useEffect(() => {
    if (addon) setValues(AddonSystem.getAddonConfig(addon.id));
  }, [addon]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && addon && !saving) onClose();
    };
    if (addon) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [addon, saving, onClose]);

  if (!addon) return null;

  const schema = addon.configSchema || [];
  const setValue = (key: string, value: unknown) => setValues((v) => ({ ...v, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await AddonSystem.updateConfig(addon.id, values);
      onSaved?.(`Configurações de "${addon.name}" salvas.`);
      onClose();
    } catch (err) {
      onSaved?.(`Erro ao salvar configurações: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const renderField = (field: AddonConfigField) => {
    const value = values[field.key] ?? field.default;
    switch (field.type) {
      case 'boolean':
        return (
          <div key={field.key} className="flex items-center justify-between gap-3 py-1">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">{field.label}</p>
              {field.description && (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">{field.description}</p>
              )}
            </div>
            <IOSSwitch checked={Boolean(value)} onChange={(c) => setValue(field.key, c)} />
          </div>
        );
      case 'color':
        return (
          <div key={field.key} className="flex items-center justify-between gap-3 py-1">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100">{field.label}</p>
              {field.description && (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">{field.description}</p>
              )}
            </div>
            <input
              type="color"
              value={typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#007aff'}
              onChange={(e) => setValue(field.key, e.target.value)}
              className="w-9 h-9 rounded-lg border border-black/[0.08] dark:border-white/[0.1] bg-transparent cursor-pointer p-0.5"
            />
          </div>
        );
      case 'select':
        return (
          <div key={field.key} className="py-1">
            <p className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100 mb-1.5">{field.label}</p>
            {field.description && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1.5">{field.description}</p>
            )}
            <IOSSelect
              options={(field.options || []).map((o) => ({ value: o, label: o }))}
              value={typeof value === 'string' ? value : ''}
              onChange={(v) => setValue(field.key, v)}
              placeholder="Selecionar…"
            />
          </div>
        );
      case 'number':
        return (
          <div key={field.key} className="py-1">
            <p className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100 mb-1.5">{field.label}</p>
            {field.description && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1.5">{field.description}</p>
            )}
            <input
              type="number"
              value={typeof value === 'number' ? value : (value as string) ?? ''}
              onChange={(e) => {
                const n = Number(e.target.value);
                setValue(field.key, e.target.value === '' ? undefined : Number.isNaN(n) ? e.target.value : n);
              }}
              className={inputClass}
            />
          </div>
        );
      case 'string':
      default:
        return (
          <div key={field.key} className="py-1">
            <p className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100 mb-1.5">{field.label}</p>
            {field.description && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mb-1.5">{field.description}</p>
            )}
            <input
              type="text"
              value={typeof value === 'string' ? value : value == null ? '' : String(value)}
              onChange={(e) => setValue(field.key, e.target.value)}
              className={inputClass}
            />
          </div>
        );
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="addon-config-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="relative w-full max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl space-y-5 max-h-[80vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="absolute top-5 right-5 p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-4 pr-6">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            <Settings className="w-6 h-6 stroke-[2]" />
          </div>
          <div className="space-y-1.5 pt-0.5">
            <h3 id="addon-config-title" className="text-lg font-bold text-zinc-900 dark:text-zinc-100 leading-snug">
              {addon.name}
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              v{addon.version}
              {addon.author ? ` · ${addon.author}` : ''}
            </p>
          </div>
        </div>

        {schema.length === 0 ? (
          <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
            Este addon não declara configurações (nenhum <span className="font-mono">configSchema</span> no manifest).
          </p>
        ) : (
          <div className="divide-y divide-black/[0.05] dark:divide-white/[0.06]">
            {schema.map(renderField)}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || schema.length === 0}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm shadow-blue-500/20 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            <span>Salvar</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
