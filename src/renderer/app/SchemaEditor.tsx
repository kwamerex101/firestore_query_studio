import { useState, useEffect } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import type { CollectionSchema } from '@shared/types/schema';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/input';
import { useToast } from '../components/ui/toast';
import { ipc } from '../lib/ipcClient';

interface SchemaEditorProps {
  collection: string;
  schema: CollectionSchema | null;
  onRefreshed(next: CollectionSchema): void;
}

export function SchemaEditor({ collection, schema, onRefreshed }: SchemaEditorProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [override, setOverride] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    setOverride(schema?.userOverride ?? '');
    setNotes(schema?.userNotes ?? '');
  }, [schema]);

  async function resample() {
    if (!collection) return;
    setBusy(true);
    try {
      const next = await ipc.schema.sample({ collection, collectionGroup: false });
      onRefreshed(next);
      toast.push(`Sampled ${next.sampledCount} docs from ${collection}`, 'success');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveOverride() {
    if (!collection) return;
    setBusy(true);
    try {
      const next = await ipc.schema.saveOverride({
        collection,
        collectionGroup: false,
        userOverride: override,
        userNotes: notes || undefined,
      });
      onRefreshed(next);
      toast.push('Schema override saved', 'success');
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-auto animate-fade-in">
      <div className="flex items-center justify-between border-b border-border p-3">
        <div>
          <div className="text-sm font-semibold">Schema for <span className="font-mono">{collection || '(none)'}</span></div>
          <div className="text-xs text-muted-foreground">
            {schema
              ? `Sampled ${schema.sampledCount} docs · ${new Date(schema.sampledAt).toLocaleString()}`
              : 'No sample yet — run Sample to infer fields from existing docs.'}
          </div>
        </div>
        <Button size="sm" onClick={resample} disabled={!collection} loading={busy}>
          {!busy ? <RefreshCw size={12} className="transition-transform duration-500 hover:rotate-180" /> : null}
          Sample
        </Button>
      </div>

      <div className="border-b border-border p-3">
        <div className="label">Inferred fields</div>
        {schema && schema.fields.length > 0 ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="pb-1 text-left">name</th>
                <th className="pb-1 text-left">types</th>
                <th className="pb-1 text-left">occ.</th>
                <th className="pb-1 text-left">example</th>
              </tr>
            </thead>
            <tbody>
              {schema.fields.map((f) => (
                <tr key={f.name} className="border-t border-border/50">
                  <td className="py-1 font-mono">{f.name}</td>
                  <td className="py-1 font-mono">{f.types.join(' | ')}</td>
                  <td className="py-1 font-mono">{f.occurrences}</td>
                  <td className="py-1 font-mono text-muted-foreground">
                    {f.examples[0] !== undefined ? JSON.stringify(f.examples[0]) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-xs text-muted-foreground">No fields available.</div>
        )}
      </div>

      <div className="flex flex-col gap-3 p-3">
        <div>
          <label className="label">User override (optional — TS interface, JSON schema, or field list)</label>
          <Textarea
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            placeholder="interface User { id: string; email: string; createdAt: Timestamp; } "
            className="min-h-[120px] font-mono"
          />
        </div>
        <div>
          <label className="label">Notes (seen by the LLM)</label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. 'email is always lowercase', 'prefer queries on indexed fields x/y'"
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" variant="primary" onClick={saveOverride} loading={busy}>
            {!busy ? <Save size={12} /> : null}
            Save override
          </Button>
        </div>
      </div>
    </div>
  );
}
