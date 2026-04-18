import type { QueryPlan, QueryOnlyPlan, ScanPlan } from '@shared/types/plan';
import { isMulti, isScan } from '@shared/types/plan';
import { cn } from '../lib/utils';

interface ExplainPanelProps {
  plan: QueryPlan;
}

function planToPseudoCode(plan: QueryOnlyPlan | ScanPlan): string {
  const lines: string[] = [];
  lines.push(
    plan.collectionGroup
      ? `db.collectionGroup("${plan.collection}")`
      : `db.collection("${plan.collection}")`,
  );
  for (const f of plan.filters) {
    lines.push(`  .where("${f.field}", "${f.op}", ${JSON.stringify(f.value)})`);
  }
  for (const o of plan.orderBy) {
    lines.push(`  .orderBy("${o.field}", "${o.dir}")`);
  }
  const fetchLimit = isScan(plan) ? Math.min(plan.scanCap, 50_000) : plan.limit;
  lines.push(`  .limit(${fetchLimit})`);
  if (isScan(plan) && plan.postFilters.length > 0) {
    lines.push('  // client-side post filters:');
    for (const pf of plan.postFilters) {
      lines.push(`  //   ${pf.field} ${pf.op} ${JSON.stringify(pf.value)}`);
    }
    lines.push(`  // final limit: ${plan.limit}`);
  }
  return lines.join('\n');
}

export function ExplainPanel({ plan }: ExplainPanelProps) {
  return (
    <div className="flex h-full flex-col overflow-auto animate-fade-in">
      <div className="border-b border-border p-3">
        <div className="mb-1 flex items-center gap-2">
          <span
            className={cn(
              'badge uppercase tracking-wider',
              plan.mode === 'query'
                ? 'border-primary/40 bg-primary/15 text-primary'
                : plan.mode === 'scan'
                ? 'border-env-staging/40 bg-env-staging/15 text-env-staging'
                : 'border-destructive/40 bg-destructive/15 text-destructive',
            )}
          >
            {plan.mode}
          </span>
          {plan.mode !== 'multi' ? (
            <span className="text-xs font-mono text-muted-foreground">
              {plan.collectionGroup ? `collectionGroup(${plan.collection})` : plan.collection}
            </span>
          ) : null}
        </div>
        <p className="text-sm">{plan.rationale}</p>
      </div>

      {plan.mode === 'scan' ? (
        <div className="border-b border-env-staging/40 bg-env-staging/10 p-3 text-xs text-env-staging">
          This is a bounded client-side scan (up to{' '}
          <span className="font-mono">{plan.scanCap}</span> docs). Latency and cost scale with the
          scanCap.
        </div>
      ) : null}
      {plan.mode === 'multi' ? (
        <div className="border-b border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          Multi-step plan with {plan.steps.length} sub-plans. Results are de-duplicated by document path.
        </div>
      ) : null}

      <div className="border-b border-border p-3">
        <div className="label">Equivalent Firestore SDK pseudo-code</div>
        <pre className="whitespace-pre-wrap rounded-md border border-border bg-background p-2 font-mono text-xs">
          {isMulti(plan)
            ? plan.steps.map((s, i) => `// step ${i + 1}\n${planToPseudoCode(s)}`).join('\n\n')
            : planToPseudoCode(plan)}
        </pre>
      </div>

      <div className="p-3">
        <div className="label">Full plan (JSON)</div>
        <pre className="whitespace-pre-wrap rounded-md border border-border bg-background p-2 font-mono text-xs">
          {JSON.stringify(plan, null, 2)}
        </pre>
      </div>
    </div>
  );
}
