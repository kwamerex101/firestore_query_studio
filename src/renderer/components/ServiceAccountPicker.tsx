import { useCallback, useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, CheckCircle2, FileJson, FolderOpen, Loader2, X } from 'lucide-react';
import { Button } from './ui/button';
import { ipc } from '../lib/ipcClient';
import { cn } from '../lib/utils';
import type { ValidateServiceAccountResult } from '@shared/types/ipc';

type ValidMeta = Extract<ValidateServiceAccountResult, { ok: true }>;

type PickerState =
  | { status: 'idle' }
  | { status: 'validating'; path: string }
  | { status: 'valid'; meta: ValidMeta }
  | { status: 'invalid'; path: string; message: string };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export interface ServiceAccountPickerProps {
  /** Absolute path currently stored on the form. Empty string means unset. */
  value: string;
  onChange: (path: string) => void;
  /**
   * The profile's `projectId`. When set, we compare it against the
   * detected `project_id` from the JSON and show a mismatch warning.
   */
  projectId?: string;
  importCopy: boolean;
  onImportChange: (next: boolean) => void;
  disabled?: boolean;
}

export function ServiceAccountPicker({
  value,
  onChange,
  projectId,
  importCopy,
  onImportChange,
  disabled = false,
}: ServiceAccountPickerProps) {
  // If the form was hydrated with a stored path (editing an existing profile)
  // we leave validation to first user interaction — the backend will re-read
  // the file on save/connect anyway, and we don't want a noisy "re-validated"
  // state for a profile the user hasn't touched.
  const [state, setState] = useState<PickerState>(
    value ? { status: 'idle' } : { status: 'idle' },
  );
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyPath = useCallback(
    async (path: string) => {
      setState({ status: 'validating', path });
      try {
        const res = await ipc.dialog.validateServiceAccount({ path });
        if (res.ok) {
          setState({ status: 'valid', meta: res });
          onChange(res.path);
        } else {
          setState({ status: 'invalid', path: res.path, message: res.message });
          onChange('');
        }
      } catch (err) {
        setState({
          status: 'invalid',
          path,
          message: err instanceof Error ? err.message : String(err),
        });
        onChange('');
      }
    },
    [onChange],
  );

  const handleBrowse = useCallback(async () => {
    if (disabled) return;
    try {
      const res = await ipc.dialog.pickServiceAccount();
      if (res.canceled) return;
      await applyPath(res.path);
    } catch (err) {
      setState({
        status: 'invalid',
        path: '',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [applyPath, disabled]);

  const handleDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (disabled) return;
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (!/\.json$/i.test(file.name)) {
        setState({
          status: 'invalid',
          path: file.name,
          message: 'Please drop a .json service-account file.',
        });
        onChange('');
        return;
      }
      let path = '';
      try {
        path = ipc.dialog.getPathForFile(file) ?? '';
      } catch (err) {
        setState({
          status: 'invalid',
          path: file.name,
          message: `Could not resolve file path: ${err instanceof Error ? err.message : String(err)}`,
        });
        onChange('');
        return;
      }
      if (!path) {
        setState({
          status: 'invalid',
          path: file.name,
          message: 'Could not resolve an absolute path for the dropped file.',
        });
        onChange('');
        return;
      }
      await applyPath(path);
    },
    [applyPath, disabled, onChange],
  );

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (disabled) return;
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setIsDragging(true);
    },
    [disabled],
  );

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleClear = useCallback(() => {
    if (disabled) return;
    setState({ status: 'idle' });
    onChange('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [disabled, onChange]);

  const handleNativeFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      let path = '';
      try {
        path = ipc.dialog.getPathForFile(file) ?? '';
      } catch {
        path = '';
      }
      if (!path) {
        setState({
          status: 'invalid',
          path: file.name,
          message: 'Could not resolve an absolute path for the selected file.',
        });
        onChange('');
        return;
      }
      await applyPath(path);
    },
    [applyPath, onChange],
  );

  const showMismatch =
    state.status === 'valid' &&
    projectId &&
    projectId.trim().length > 0 &&
    state.meta.projectId !== projectId.trim();

  const hasPath = value.length > 0 || state.status === 'valid';
  const displayPath =
    state.status === 'valid'
      ? state.meta.path
      : state.status === 'validating'
        ? state.path
        : value;

  return (
    <div>
      <label className="label">Service-account JSON</label>
      <div
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'relative flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-4 text-center transition-colors',
          isDragging
            ? 'border-primary bg-primary/10'
            : state.status === 'invalid'
              ? 'border-env-prod/60 bg-env-prod/5'
              : state.status === 'valid'
                ? 'border-env-dev/60 bg-env-dev/5'
                : 'border-border bg-muted/20 hover:border-primary/60',
          disabled && 'opacity-60',
        )}
      >
        {state.status === 'validating' ? (
          <Loader2 size={18} className="animate-spin text-primary" />
        ) : state.status === 'valid' ? (
          <CheckCircle2 size={18} className="text-env-dev" />
        ) : state.status === 'invalid' ? (
          <AlertTriangle size={18} className="text-env-prod" />
        ) : (
          <FileJson size={18} className="text-muted-foreground" />
        )}

        {state.status === 'valid' ? (
          <div className="min-w-0 w-full text-xs">
            <div className="truncate font-mono text-foreground" title={state.meta.path}>
              {basename(state.meta.path)}
            </div>
            <div className="truncate text-muted-foreground" title={state.meta.path}>
              {state.meta.path}
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-muted-foreground">
              <span>
                project_id: <span className="font-mono text-foreground">{state.meta.projectId}</span>
              </span>
              <span>
                client_email:{' '}
                <span className="font-mono text-foreground">{state.meta.clientEmail}</span>
              </span>
              <span>{formatBytes(state.meta.sizeBytes)}</span>
            </div>
          </div>
        ) : state.status === 'validating' ? (
          <div className="text-xs text-muted-foreground">Validating {basename(state.path)}…</div>
        ) : state.status === 'invalid' ? (
          <div className="min-w-0 w-full text-xs">
            <div className="font-medium text-env-prod">{state.message}</div>
            {state.path ? (
              <div className="mt-0.5 truncate text-muted-foreground" title={state.path}>
                {state.path}
              </div>
            ) : null}
          </div>
        ) : hasPath ? (
          <div className="min-w-0 w-full text-xs">
            <div className="truncate font-mono text-foreground" title={displayPath}>
              {basename(displayPath)}
            </div>
            <div className="truncate text-muted-foreground" title={displayPath}>
              {displayPath}
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Drop a service-account <span className="font-mono">.json</span> here, or
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleBrowse}
            disabled={disabled || state.status === 'validating'}
          >
            <FolderOpen size={14} />
            Browse…
          </Button>
          {hasPath || state.status === 'invalid' ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleClear}
              disabled={disabled || state.status === 'validating'}
              aria-label="Clear selection"
              title="Clear selection"
            >
              <X size={14} />
              Clear
            </Button>
          ) : null}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            void handleNativeFile(e.target.files?.[0] ?? null);
          }}
        />
      </div>

      {showMismatch ? (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-env-staging/40 bg-env-staging/10 p-2 text-xs">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0 text-env-staging" />
          <div>
            This key's <span className="font-mono">project_id</span> is{' '}
            <span className="font-mono">{state.status === 'valid' ? state.meta.projectId : ''}</span>
            , but the profile's Project ID is{' '}
            <span className="font-mono">{projectId}</span>. Connecting will fail until these
            match.
          </div>
        </div>
      ) : null}

      <label className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={importCopy}
          onChange={(e) => onImportChange(e.target.checked)}
          disabled={disabled}
        />
        <span>
          Import a copy into app storage. The file is copied to the app's user-data
          directory on save; the profile stays usable even if you move or delete the
          original. Leave off to reference the file in place.
        </span>
      </label>
    </div>
  );
}
