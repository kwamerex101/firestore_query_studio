import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Sparkles, RefreshCw, Lightbulb, AlertTriangle, Copy, Check } from 'lucide-react';
import type { QueryPlan } from '@shared/types/plan';
import type { RunOutcome } from '@shared/types/results';
import type { InsightsGenerateOutcome } from '@shared/types/ipc';
import { ipc } from '../lib/ipcClient';
import { Button } from '../components/ui/button';
import { useToast } from '../components/ui/toast';
import { cn } from '../lib/utils';

interface InsightsPanelProps {
  question: string;
  collection: string | undefined;
  plan: QueryPlan | null;
  outcome: RunOutcome | null;
}

/**
 * We cache the last-generated insight in a ref keyed by the outcome's
 * object identity — so flipping tabs doesn't lose it, but running a new
 * query does. Plumbing into persistent storage can happen later if users
 * ask for it.
 */
interface CachedInsight {
  outcomeRef: RunOutcome;
  insight: string;
  model?: string;
  elapsedMs: number;
  rowSampleTruncated: boolean;
  generatedAt: number;
}

export function InsightsPanel({ question, collection, plan, outcome }: InsightsPanelProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [cached, setCached] = useState<CachedInsight | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<{ aborted: boolean } | null>(null);

  // Invalidate the cached insight when the outcome reference changes, since
  // it no longer corresponds to what's on screen.
  useEffect(() => {
    if (cached && cached.outcomeRef !== outcome) {
      setCached(null);
      setError(null);
    }
  }, [outcome, cached]);

  async function generate() {
    if (!plan || !outcome) return;
    setLoading(true);
    setError(null);
    const token = { aborted: false };
    abortRef.current = token;
    try {
      const res: InsightsGenerateOutcome = await ipc.insights.generate({
        question,
        collection,
        plan,
        outcome,
      });
      if (token.aborted) return;
      if (!res.ok) {
        setError({ code: res.code, message: res.message });
        setCached(null);
        return;
      }
      setCached({
        outcomeRef: outcome,
        insight: res.insight,
        model: res.model,
        elapsedMs: res.elapsedMs,
        rowSampleTruncated: res.rowSampleTruncated,
        generatedAt: Date.now(),
      });
    } catch (err) {
      if (token.aborted) return;
      setError({
        code: 'UNEXPECTED',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (!token.aborted) setLoading(false);
    }
  }

  async function copyMarkdown() {
    if (!cached) return;
    try {
      await navigator.clipboard.writeText(cached.insight);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.push(err instanceof Error ? err.message : 'Copy failed', 'error');
    }
  }

  // Abort pending call when the outcome changes or component unmounts,
  // so a slow LLM response doesn't clobber the UI with stale data.
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.aborted = true;
    };
  }, [outcome]);

  if (!plan || !outcome) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground animate-fade-in">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary/60 text-primary">
            <Lightbulb size={16} />
          </div>
          <div className="max-w-xs text-balance">
            Run a query to get AI-generated insights about the results here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-auto animate-fade-in">
      <div className="flex items-center gap-2 border-b border-border p-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-glow-primary">
          <Sparkles size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">AI insights</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {cached
              ? `Generated ${formatRelative(cached.generatedAt)}${
                  cached.model ? ` · ${cached.model}` : ''
                } · ${formatDuration(cached.elapsedMs)}`
              : outcome.ok
              ? `${outcome.rows.length} ${outcome.rows.length === 1 ? 'row' : 'rows'} ready for analysis`
              : `Run failed: ${outcome.code}`}
          </div>
        </div>
        {cached ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={copyMarkdown}
            title="Copy insight as markdown"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant={cached ? 'default' : 'primary'}
          onClick={generate}
          loading={loading}
          disabled={loading}
          title={cached ? 'Regenerate insights' : 'Generate insights from the results'}
        >
          {!loading ? (
            cached ? <RefreshCw size={12} /> : <Sparkles size={12} />
          ) : null}
          {loading ? 'Thinking…' : cached ? 'Regenerate' : 'Generate'}
        </Button>
      </div>

      <div className="min-h-0 flex-1">
        {error ? (
          <div className="m-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            <div>
              <div className="font-semibold">{error.code}</div>
              <div className="mt-1 whitespace-pre-wrap text-foreground/90">{error.message}</div>
            </div>
          </div>
        ) : cached ? (
          <div className="p-4 text-sm leading-relaxed">
            <Markdown source={cached.insight} />
            {cached.rowSampleTruncated ? (
              <div className="mt-4 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <AlertTriangle size={11} />
                Analysis was based on a truncated sample of the returned rows.
              </div>
            ) : null}
          </div>
        ) : loading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <span className="spinner" aria-hidden />
            Asking the model…
          </div>
        ) : (
          <EmptyPrompt outcome={outcome} />
        )}
      </div>
    </div>
  );
}

function EmptyPrompt({ outcome }: { outcome: RunOutcome }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground animate-fade-in">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary/60 text-primary">
        <Lightbulb size={16} />
      </div>
      <div className="max-w-xs text-balance">
        {outcome.ok
          ? outcome.rows.length === 0
            ? 'The result is empty — get the model to suggest why and what to try next.'
            : 'Click Generate to get a short, data-grounded analysis of the rows.'
          : 'Click Generate to get a plain-English explanation of the error and next steps.'}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Minimal markdown renderer                                          */
/* ------------------------------------------------------------------ */

/**
 * A small, dependency-free renderer for the subset of markdown we ask the
 * model to emit: headings, unordered lists, bold/italic/code spans, fenced
 * code blocks, blockquotes, and auto-links. Content is inserted as text
 * (never via innerHTML), so it is safe by construction.
 */
function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let keyCounter = 0;
  const nextKey = () => `b-${keyCounter++}`;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const fenceLang = line.slice(3).trim();
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(
        <pre
          key={nextKey()}
          data-lang={fenceLang || undefined}
          className="my-3 overflow-auto rounded-md border border-border bg-background/80 p-2 font-mono text-[11px] leading-relaxed"
        >
          {buf.join('\n')}
        </pre>,
      );
      continue;
    }

    // Blank separator
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^\s*---+\s*$/.test(line)) {
      blocks.push(<hr key={nextKey()} className="my-3 border-border" />);
      i += 1;
      continue;
    }

    // Headings
    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      blocks.push(
        <Heading key={nextKey()} level={level}>
          {renderInline(text)}
        </Heading>,
      );
      i += 1;
      continue;
    }

    // Blockquote
    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={nextKey()}
          className="my-2 border-l-2 border-primary/40 bg-secondary/30 px-3 py-1.5 text-sm text-foreground/90"
        >
          {quoteLines.map((l, k) => (
            <p key={k} className="whitespace-pre-wrap">
              {renderInline(l)}
            </p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // Unordered list (consecutive `- ` or `* ` lines)
    if (/^\s*[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*[-*]\s+/, '');
        items.push(
          <li key={items.length} className="mb-1 last:mb-0">
            {renderInline(content)}
          </li>,
        );
        i += 1;
      }
      blocks.push(
        <ul key={nextKey()} className="my-2 list-disc space-y-0.5 pl-5 text-sm">
          {items}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*\d+\.\s+/, '');
        items.push(
          <li key={items.length} className="mb-1 last:mb-0">
            {renderInline(content)}
          </li>,
        );
        i += 1;
      }
      blocks.push(
        <ol key={nextKey()} className="my-2 list-decimal space-y-0.5 pl-5 text-sm">
          {items}
        </ol>,
      );
      continue;
    }

    // Paragraph: gather consecutive non-empty, non-special lines
    const paraLines: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !lines[i].startsWith('```')
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={nextKey()} className="my-2 text-sm leading-relaxed">
        {renderInline(paraLines.join(' '))}
      </p>,
    );
  }

  return <div className="markdown">{blocks}</div>;
}

function Heading({ level, children }: { level: number; children: ReactNode }) {
  const cls = cn(
    'mt-4 font-semibold',
    level <= 1 && 'text-base',
    level === 2 && 'text-sm uppercase tracking-wide text-muted-foreground',
    level >= 3 && 'text-xs uppercase tracking-wide text-muted-foreground',
  );
  if (level === 1) return <h1 className={cls}>{children}</h1>;
  if (level === 2) return <h2 className={cls}>{children}</h2>;
  if (level === 3) return <h3 className={cls}>{children}</h3>;
  if (level === 4) return <h4 className={cls}>{children}</h4>;
  if (level === 5) return <h5 className={cls}>{children}</h5>;
  return <h6 className={cls}>{children}</h6>;
}

/**
 * Tokenize a line into inline spans: code → bold → italic → links. We walk
 * the string and split on the earliest opener to avoid nested-delimiter
 * edge cases that a naive global regex would mangle (e.g. `**` inside of
 * `` ` ``).
 */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let key = 0;

  while (rest.length > 0) {
    // Inline code
    const codeStart = rest.indexOf('`');
    // Bold
    const boldStart = findFirstMarker(rest, '**');
    // Italic: single * or _ that isn't a bold
    const italicStart = findFirstItalic(rest);
    // Link
    const linkMatch = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/.exec(rest);

    const candidates = [
      codeStart >= 0 ? { type: 'code' as const, idx: codeStart } : null,
      boldStart >= 0 ? { type: 'bold' as const, idx: boldStart } : null,
      italicStart >= 0 ? { type: 'italic' as const, idx: italicStart } : null,
      linkMatch ? { type: 'link' as const, idx: linkMatch.index, match: linkMatch } : null,
    ].filter(Boolean) as Array<
      | { type: 'code'; idx: number }
      | { type: 'bold'; idx: number }
      | { type: 'italic'; idx: number }
      | { type: 'link'; idx: number; match: RegExpExecArray }
    >;

    if (candidates.length === 0) {
      nodes.push(<span key={key++}>{rest}</span>);
      break;
    }

    candidates.sort((a, b) => a.idx - b.idx);
    const first = candidates[0];

    if (first.idx > 0) {
      nodes.push(<span key={key++}>{rest.slice(0, first.idx)}</span>);
    }

    if (first.type === 'code') {
      const after = rest.slice(first.idx + 1);
      const closeIdx = after.indexOf('`');
      if (closeIdx === -1) {
        nodes.push(<span key={key++}>{rest.slice(first.idx)}</span>);
        break;
      }
      nodes.push(
        <code
          key={key++}
          className="rounded bg-secondary/70 px-1 py-0.5 font-mono text-[11px] text-foreground/90"
        >
          {after.slice(0, closeIdx)}
        </code>,
      );
      rest = after.slice(closeIdx + 1);
    } else if (first.type === 'bold') {
      const after = rest.slice(first.idx + 2);
      const closeIdx = findFirstMarker(after, '**');
      if (closeIdx === -1) {
        nodes.push(<span key={key++}>{rest.slice(first.idx)}</span>);
        break;
      }
      nodes.push(
        <strong key={key++} className="font-semibold text-foreground">
          {renderInline(after.slice(0, closeIdx))}
        </strong>,
      );
      rest = after.slice(closeIdx + 2);
    } else if (first.type === 'italic') {
      const marker = rest[first.idx];
      const after = rest.slice(first.idx + 1);
      const closeIdx = after.indexOf(marker);
      if (closeIdx === -1) {
        nodes.push(<span key={key++}>{rest.slice(first.idx)}</span>);
        break;
      }
      nodes.push(
        <em key={key++} className="italic text-foreground/90">
          {renderInline(after.slice(0, closeIdx))}
        </em>,
      );
      rest = after.slice(closeIdx + 1);
    } else if (first.type === 'link') {
      const [, label, url] = first.match;
      nodes.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-primary underline-offset-2 hover:underline"
        >
          {label}
        </a>,
      );
      rest = rest.slice(first.idx + first.match[0].length);
    }
  }

  return nodes;
}

function findFirstMarker(s: string, marker: string): number {
  const idx = s.indexOf(marker);
  return idx >= 0 ? idx : -1;
}

function findFirstItalic(s: string): number {
  // Find a single `*` or `_` that isn't part of `**` or `__`.
  for (let k = 0; k < s.length; k += 1) {
    const ch = s[k];
    if (ch !== '*' && ch !== '_') continue;
    if (s[k + 1] === ch) {
      k += 1;
      continue;
    }
    if (k > 0 && s[k - 1] === ch) continue;
    return k;
  }
  return -1;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
