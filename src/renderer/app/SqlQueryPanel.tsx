import { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Wand2, RefreshCw, Sparkles, Database, Copy } from 'lucide-react';
import type {
  SqlPlan,
} from '@shared/types/sqlPlan';
import type {
  SqlExecuteOutcome,
  DbContainer,
  SqlColumn,
  SqlRow,
} from '@shared/types/ipc';
import type { Profile } from '@shared/types/profile';
import { isSqlHistoryEntry } from '@shared/types/history';
import { useAppState } from '../state/AppState';
import { ipc } from '../lib/ipcClient';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { useToast } from '../components/ui/toast';
import { SqlResultsTable } from './SqlResultsTable';
import { cn } from '../lib/utils';

interface SqlQueryPanelProps {
  profile: Profile & { engine: 'postgres' | 'mysql' | 'mssql' };
  hasLlmConfigured: boolean;
}

type TabKey = 'plan' | 'rationale';

/**
 * NL→SQL panel shown when the active profile is a relational engine. Reuses
 * the same two-column layout as the Firestore `QueryPage` (question + plan
 * on the left, rationale/plan-as-JSON on the right) and the virtualised
 * results table below.
 */
export function SqlQueryPanel({ profile, hasLlmConfigured }: SqlQueryPanelProps) {
  const toast = useToast();
  const { pendingHistory, clearPendingHistory, notifyHistoryChanged } = useAppState();
  const [question, setQuestion] = useState('');
  const [tables, setTables] = useState<DbContainer[]>([]);
  const [table, setTable] = useState<string>('');
  const [plan, setPlan] = useState<SqlPlan | null>(null);
  const [editableSql, setEditableSql] = useState<string>('');
  const [outcome, setOutcome] = useState<SqlExecuteOutcome | null>(null);
  const [building, setBuilding] = useState(false);
  const [running, setRunning] = useState(false);
  const [autoRun, setAutoRun] = useState(true);
  const [rightTab, setRightTab] = useState<TabKey>('rationale');

  const reloadTables = useCallback(async () => {
    try {
      const res = await ipc.db.listContainers();
      setTables(res.containers);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    }
  }, [toast]);

  useEffect(() => {
    setPlan(null);
    setOutcome(null);
    setTable('');
    setTables([]);
    setEditableSql('');
    void reloadTables();
  }, [profile.id, reloadTables]);

  useEffect(() => {
    if (!pendingHistory || !isSqlHistoryEntry(pendingHistory)) return;
    if (pendingHistory.profileId !== profile.id) return;
    setQuestion(pendingHistory.question);
    setPlan(pendingHistory.sqlPlan);
    setEditableSql(pendingHistory.sqlPlan.sql);
    setOutcome(pendingHistory.outcome);
    setRightTab('rationale');
    clearPendingHistory();
  }, [pendingHistory, clearPendingHistory, profile.id]);

  async function buildPlan() {
    if (!hasLlmConfigured) {
      toast.push('Configure LLM API key in Settings.', 'error');
      return;
    }
    if (!question.trim()) {
      toast.push('Type a question first.', 'error');
      return;
    }
    setBuilding(true);
    setOutcome(null);
    try {
      const res = await ipc.plan.buildSql({
        question: question.trim(),
        table: table || undefined,
        allowScan: true,
      });
      if (!res.ok) {
        toast.push(`Plan failed: ${res.code} — ${res.message}`, 'error');
        setPlan(null);
        setEditableSql('');
        return;
      }
      setPlan(res.plan);
      setEditableSql(res.plan.sql);
      setRightTab('rationale');
      if (autoRun) {
        await runSql(res.plan.sql, res.plan.limit, res.plan);
      }
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBuilding(false);
    }
  }

  async function runSql(sql: string, limit?: number, planContext?: SqlPlan | null) {
    if (!sql.trim()) {
      toast.push('Nothing to run.', 'error');
      return;
    }
    const effectivePlan = planContext !== undefined ? planContext : plan;
    setRunning(true);
    try {
      const res = await ipc.db.executeSql({ sql, limit });
      setOutcome(res);
      if (!res.ok) {
        toast.push(`Run failed: ${res.code}`, 'error');
      } else {
        toast.push(
          `Returned ${res.rows.length} row${res.rows.length === 1 ? '' : 's'} in ${res.elapsedMs}ms`,
          'success',
        );
      }
      const runLimit = limit ?? effectivePlan?.limit ?? profile.defaultLimit;
      const sqlPlanForHistory: SqlPlan = effectivePlan
        ? { ...effectivePlan, sql, limit: runLimit }
        : {
            mode: 'sql',
            dialect: profile.engine,
            sql,
            rationale: 'Run without a generated plan in this session.',
            limit: runLimit,
            tables: [],
          };
      try {
        await ipc.history.add({
          source: 'sql',
          question: question.trim() || '(SQL run)',
          sqlPlan: sqlPlanForHistory,
          outcome: res,
        });
        notifyHistoryChanged();
      } catch (historyErr) {
        // eslint-disable-next-line no-console
        console.warn('Failed to save history entry', historyErr);
      }
    } catch (err) {
      toast.push(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setRunning(false);
    }
  }

  const busy = building || running;
  const okResult = outcome && outcome.ok ? outcome : null;
  const errResult = outcome && !outcome.ok ? outcome : null;

  const dialectLabel = useMemo(() => {
    switch (profile.engine) {
      case 'postgres':
        return 'PostgreSQL';
      case 'mysql':
        return 'MySQL';
      case 'mssql':
        return 'SQL Server';
    }
  }, [profile.engine]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-col lg:border-r lg:border-border">
        <div
          className={cn(
            'rounded-none border-b border-border p-3 transition-all',
            building && 'working-border',
          )}
        >
          <div className="grid grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(0,1fr)_220px_auto]">
            <div>
              <label className="label">
                <Sparkles size={10} className="mr-1 inline-block align-[-1px]" />
                Natural-language question
              </label>
              <Textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={`e.g. "show the 10 most recent orders with their total"`}
                rows={2}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (!busy) void buildPlan();
                  }
                }}
              />
            </div>
            <div>
              <label className="label">Table hint</label>
              <div className="flex gap-1">
                <Select value={table} onChange={(e) => setTable(e.target.value)}>
                  <option value="">(let LLM pick)</option>
                  {tables.map((t) => {
                    const name = t.schema ? `${t.schema}.${t.name}` : t.name;
                    return (
                      <option key={`${t.schema ?? ''}.${t.name}`} value={t.name}>
                        {name}
                      </option>
                    );
                  })}
                </Select>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={reloadTables}
                  title="Reload tables"
                  aria-label="Reload tables"
                >
                  <RefreshCw
                    size={12}
                    className="transition-transform duration-300 hover:rotate-180"
                  />
                </Button>
              </div>
              <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
                <input
                  type="checkbox"
                  checked={autoRun}
                  onChange={(e) => setAutoRun(e.target.checked)}
                  className="h-3 w-3 accent-primary transition-all"
                />
                Run SQL automatically after build
              </label>
            </div>
            <div className="flex flex-col gap-1 pt-4">
              <Button
                variant="primary"
                onClick={buildPlan}
                disabled={busy}
                loading={building}
                title={autoRun ? 'Build plan and run (⌘↵)' : 'Build plan (⌘↵)'}
              >
                {!building ? <Wand2 size={14} /> : null}
                {building ? 'Building…' : autoRun ? 'Ask' : 'Build SQL'}
              </Button>
              <Button
                onClick={() => runSql(editableSql || plan?.sql || '', plan?.limit)}
                disabled={(!plan && !editableSql) || busy}
                loading={running}
                title="Run the current SQL without calling the LLM."
              >
                {!running ? <Play size={14} /> : null}
                {running ? 'Running…' : 'Run'}
              </Button>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <Database size={11} />
            <span>
              Active: <span className="font-mono text-foreground/80">{profile.name}</span>{' '}
              · <span className="font-mono">{dialectLabel}</span>
            </span>
          </div>

          {plan || editableSql ? (
            <div className="mt-3">
              <label className="label">Generated SQL (editable)</label>
              <Textarea
                value={editableSql}
                onChange={(e) => setEditableSql(e.target.value)}
                rows={6}
                className="font-mono text-[11px]"
                spellCheck={false}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                The driver re-validates this through the read-only safety gate before running.
                Writes (INSERT/UPDATE/DELETE) are rejected.
              </p>
            </div>
          ) : null}
        </div>

        <div className="min-h-[240px] flex-1 lg:min-h-0">
          {okResult ? (
            <SqlResultsTable
              columns={okResult.columns as SqlColumn[]}
              rows={okResult.rows as SqlRow[]}
              question={question}
              sql={editableSql || plan?.sql}
              truncated={okResult.truncated}
              elapsedMs={okResult.elapsedMs}
            />
          ) : errResult ? (
            <div className="p-4">
              <div className="mb-2 text-sm font-semibold text-destructive">
                Run failed: {errResult.code}
              </div>
              <pre className="whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
                {errResult.message}
              </pre>
              {errResult.executedSql ? (
                <div className="mt-3">
                  <div className="text-xs text-muted-foreground">Executed SQL:</div>
                  <pre className="mt-1 whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2 text-[11px] font-mono">
                    {errResult.executedSql}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : (
            <EmptyResults hasPlan={plan !== null} />
          )}
        </div>

        {okResult ? (
          <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            <Stat label="rows" value={okResult.rows.length} />
            <Stat label="time" value={`${okResult.elapsedMs}ms`} />
            {okResult.truncated ? (
              <span className="rounded-sm bg-env-staging/20 px-1.5 py-0.5 text-env-staging">
                truncated
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-col border-t border-border lg:border-t-0">
        <div className="flex items-center gap-2 border-b border-border px-2 py-2 text-xs font-medium">
          {(['rationale', 'plan'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setRightTab(t)}
              className={cn(
                'rounded-sm px-2 py-1 transition-colors capitalize',
                rightTab === t
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t === 'plan' ? 'Plan JSON' : 'Rationale'}
            </button>
          ))}
        </div>
        <div className="min-h-[280px] flex-1 lg:min-h-0 overflow-auto p-3">
          {rightTab === 'rationale' ? (
            plan ? (
              <div className="space-y-3 text-xs">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Rationale
                  </div>
                  <p className="mt-1 text-foreground/90">{plan.rationale}</p>
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Query
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(plan.sql);
                          toast.push('SQL copied to clipboard', 'success');
                        } catch {
                          toast.push('Could not copy to clipboard', 'error');
                        }
                      }}
                    >
                      <Copy size={10} aria-hidden />
                      Copy
                    </Button>
                  </div>
                  {editableSql !== plan.sql ? (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      The main SQL editor differs from this — shown below is the
                      plan output that matches the rationale.
                    </p>
                  ) : null}
                  <pre className="mt-1 max-h-[200px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2 text-[11px] font-mono text-foreground/90">
                    {plan.sql}
                  </pre>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Tables referenced
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {plan.tables.length > 0 ? (
                      plan.tables.map((t) => (
                        <span
                          key={t}
                          className="rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px]"
                        >
                          {t}
                        </span>
                      ))
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="dialect" value={plan.dialect} />
                  <Stat label="limit" value={plan.limit} />
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center text-sm text-muted-foreground">
                <Wand2 size={18} className="text-primary" />
                Ask a question to see the planner's rationale here.
              </div>
            )
          ) : (
            <pre className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-2 text-[11px] font-mono">
              {plan ? JSON.stringify(plan, null, 2) : '(no plan yet)'}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="font-mono text-foreground/90">{value}</span>
    </span>
  );
}

function EmptyResults({ hasPlan }: { hasPlan: boolean }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary/60 text-primary">
          {hasPlan ? <Play size={16} /> : <Sparkles size={16} />}
        </div>
        <div>
          {hasPlan
            ? 'SQL ready — press Run to execute.'
            : 'Ask a question to generate SQL, or type your own into the editor above.'}
        </div>
        {!hasPlan ? (
          <div className="text-[11px] text-muted-foreground/70">
            Tip: press <kbd className="rounded bg-secondary px-1 py-0.5 font-mono">⌘ ↵</kbd> to build.
          </div>
        ) : null}
      </div>
    </div>
  );
}
