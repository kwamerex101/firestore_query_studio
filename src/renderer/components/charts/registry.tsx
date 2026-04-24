import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type {
  AreaSpec,
  BarSpec,
  HistogramSpec,
  KpiSpec,
  LineSpec,
  PieSpec,
  ScatterSpec,
  VisualSpec,
} from '@shared/types/visualPlan';
import { cn } from '../../lib/utils';

/**
 * Chart component registry. Each entry renders one `VisualSpec` variant.
 * The renderer dispatches on `spec.type`; adding a new chart type means
 * adding a new `VisualSpec` variant, a component here, and a case in the
 * switch at the bottom.
 */

/* ------------------------------------------------------------------ */
/*  Shared styling                                                     */
/* ------------------------------------------------------------------ */

const PRIMARY = 'hsl(217 91% 62%)';
const PALETTE = [
  'hsl(217 91% 62%)',
  'hsl(142 71% 45%)',
  'hsl(38 92% 50%)',
  'hsl(330 81% 60%)',
  'hsl(262 83% 66%)',
  'hsl(168 76% 42%)',
  'hsl(0 84% 60%)',
  'hsl(48 96% 53%)',
];
const GRID_STROKE = 'hsl(215 28% 22%)';
const AXIS_STROKE = 'hsl(217 12% 55%)';

const tooltipStyle = {
  backgroundColor: 'hsl(222 40% 10%)',
  border: '1px solid hsl(215 28% 18%)',
  borderRadius: 6,
  fontSize: 11,
  color: 'hsl(210 40% 98%)',
};
const tooltipCursor = { fill: 'hsl(215 28% 20% / 0.35)' };

function ChartCard({
  title,
  className,
  children,
  hint,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-md border border-border/60 bg-card/40 p-3',
        className,
      )}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold text-foreground/90">{title}</h4>
        {hint ? (
          <span className="text-[10px] text-muted-foreground/70">{hint}</span>
        ) : null}
      </div>
      {/*
       * Explicit height is non-negotiable for recharts' ResponsiveContainer:
       * it measures parent `clientHeight` on mount and a `flex-1 min-h-*`
       * combination resolves to 0 inside a scrollable grid cell, leaving the
       * chart invisible. Fixed 240px matches the old implicit target height
       * and plays nicely with the outer `min-h-[260px]` card in VisualView.
       */}
      <div className="h-[240px] w-full">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Value formatting                                                   */
/* ------------------------------------------------------------------ */

function formatKpiValue(
  value: number | string,
  format?: KpiSpec['format'],
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return String(value);
  }
  try {
    switch (format) {
      case 'percent':
        return `${(value * 100).toFixed(1)}%`;
      case 'currency':
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 2,
        }).format(value);
      case 'duration':
        return formatDuration(value);
      default:
        return new Intl.NumberFormat(undefined, {
          maximumFractionDigits: 2,
        }).format(value);
    }
  } catch {
    return String(value);
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = sec / 60;
  if (min < 60) return `${min.toFixed(1)}m`;
  const hr = min / 60;
  if (hr < 24) return `${hr.toFixed(1)}h`;
  return `${(hr / 24).toFixed(1)}d`;
}

/* ------------------------------------------------------------------ */
/*  KPI                                                                */
/* ------------------------------------------------------------------ */

export function KpiCard({ spec }: { spec: KpiSpec }) {
  const text = formatKpiValue(spec.value, spec.format);
  const hasDelta = typeof spec.delta === 'number' && Number.isFinite(spec.delta);
  const positive = hasDelta && (spec.delta as number) >= 0;
  return (
    <div className="flex flex-col rounded-md border border-border/60 bg-card/40 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {spec.title}
      </div>
      <div className="mt-1 font-mono text-2xl tabular-nums text-foreground">
        {text}
      </div>
      {hasDelta ? (
        <div
          className={cn(
            'mt-1 text-[11px] font-medium',
            positive ? 'text-env-dev' : 'text-destructive',
          )}
        >
          {positive ? '+' : ''}
          {spec.delta}
        </div>
      ) : null}
      {spec.hint ? (
        <div className="mt-1 text-[11px] text-muted-foreground">{spec.hint}</div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Bar                                                                */
/* ------------------------------------------------------------------ */

export function BarChartCard({ spec }: { spec: BarSpec }) {
  const horizontal = spec.orientation === 'horizontal';
  return (
    <ChartCard title={spec.title}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={spec.data}
          layout={horizontal ? 'vertical' : 'horizontal'}
          margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={GRID_STROKE}
            horizontal={!horizontal}
            vertical={horizontal}
          />
          {horizontal ? (
            <>
              <XAxis
                type="number"
                stroke={AXIS_STROKE}
                fontSize={10}
                label={axisLabel(spec.yLabel, 'x')}
              />
              <YAxis
                type="category"
                dataKey={spec.xField}
                stroke={AXIS_STROKE}
                fontSize={10}
                width={100}
                label={axisLabel(spec.xLabel, 'y')}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey={spec.xField}
                stroke={AXIS_STROKE}
                fontSize={10}
                label={axisLabel(spec.xLabel, 'x')}
              />
              <YAxis
                stroke={AXIS_STROKE}
                fontSize={10}
                label={axisLabel(spec.yLabel, 'y')}
              />
            </>
          )}
          <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} />
          <Bar
            dataKey={horizontal ? spec.yField : spec.yField}
            fill={PRIMARY}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Line                                                               */
/* ------------------------------------------------------------------ */

export function LineChartCard({ spec }: { spec: LineSpec }) {
  return (
    <ChartCard title={spec.title}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={spec.data}
          margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis
            dataKey={spec.xField}
            stroke={AXIS_STROKE}
            fontSize={10}
            label={axisLabel(spec.xLabel, 'x')}
          />
          <YAxis
            stroke={AXIS_STROKE}
            fontSize={10}
            label={axisLabel(spec.yLabel, 'y')}
          />
          <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} />
          <Line
            type="monotone"
            dataKey={spec.yField}
            stroke={PRIMARY}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Area                                                               */
/* ------------------------------------------------------------------ */

export function AreaChartCard({ spec }: { spec: AreaSpec }) {
  return (
    <ChartCard title={spec.title}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={spec.data}
          margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
        >
          <defs>
            <linearGradient id="area-fill-primary" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.4} />
              <stop offset="100%" stopColor={PRIMARY} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis
            dataKey={spec.xField}
            stroke={AXIS_STROKE}
            fontSize={10}
            label={axisLabel(spec.xLabel, 'x')}
          />
          <YAxis
            stroke={AXIS_STROKE}
            fontSize={10}
            label={axisLabel(spec.yLabel, 'y')}
          />
          <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} />
          <Area
            type="monotone"
            dataKey={spec.yField}
            stroke={PRIMARY}
            strokeWidth={2}
            fill="url(#area-fill-primary)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Pie                                                                */
/* ------------------------------------------------------------------ */

export function PieChartCard({ spec }: { spec: PieSpec }) {
  return (
    <ChartCard title={spec.title}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={spec.data}
            dataKey={spec.valueField}
            nameKey={spec.labelField}
            innerRadius={40}
            outerRadius={80}
            paddingAngle={2}
            isAnimationActive={false}
          >
            {spec.data.map((_, i) => (
              <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend
            verticalAlign="bottom"
            height={24}
            wrapperStyle={{ fontSize: 10, color: 'hsl(217 12% 66%)' }}
          />
        </PieChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Histogram                                                          */
/* ------------------------------------------------------------------ */

export function HistogramChartCard({ spec }: { spec: HistogramSpec }) {
  return (
    <ChartCard title={spec.title} hint={`field: ${spec.field}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={spec.bins}
          margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis
            dataKey="label"
            stroke={AXIS_STROKE}
            fontSize={10}
            label={axisLabel(spec.xLabel, 'x')}
          />
          <YAxis
            stroke={AXIS_STROKE}
            fontSize={10}
            allowDecimals={false}
            label={axisLabel(spec.yLabel ?? 'count', 'y')}
          />
          <Tooltip contentStyle={tooltipStyle} cursor={tooltipCursor} />
          <Bar dataKey="count" fill={PRIMARY} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Scatter                                                            */
/* ------------------------------------------------------------------ */

export function ScatterChartCard({ spec }: { spec: ScatterSpec }) {
  return (
    <ChartCard title={spec.title}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
          <XAxis
            type="number"
            dataKey={spec.xField}
            stroke={AXIS_STROKE}
            fontSize={10}
            label={axisLabel(spec.xLabel, 'x')}
          />
          <YAxis
            type="number"
            dataKey={spec.yField}
            stroke={AXIS_STROKE}
            fontSize={10}
            label={axisLabel(spec.yLabel, 'y')}
          />
          <ZAxis range={[40, 40]} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={spec.data} fill={PRIMARY} />
        </ScatterChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Dispatcher                                                         */
/* ------------------------------------------------------------------ */

function axisLabel(value: string | undefined, axis: 'x' | 'y') {
  if (!value) return undefined;
  return axis === 'x'
    ? {
        value,
        position: 'insideBottom' as const,
        fill: AXIS_STROKE,
        fontSize: 10,
        offset: -2,
      }
    : {
        value,
        position: 'insideLeft' as const,
        fill: AXIS_STROKE,
        fontSize: 10,
        offset: 10,
      };
}

/**
 * Render one spec. Chart types we don't recognize (shouldn't happen
 * because Zod has already validated) render a small placeholder.
 */
export function VisualRenderer({ spec }: { spec: VisualSpec }) {
  switch (spec.type) {
    case 'kpi':
      return <KpiCard spec={spec} />;
    case 'bar':
      return <BarChartCard spec={spec} />;
    case 'line':
      return <LineChartCard spec={spec} />;
    case 'area':
      return <AreaChartCard spec={spec} />;
    case 'pie':
      return <PieChartCard spec={spec} />;
    case 'histogram':
      return <HistogramChartCard spec={spec} />;
    case 'scatter':
      return <ScatterChartCard spec={spec} />;
    default: {
      const never: never = spec;
      void never;
      return (
        <div className="flex min-h-[120px] items-center justify-center rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          Unknown chart type
        </div>
      );
    }
  }
}

/**
 * Static list of chart types the registry supports. Exposed so other
 * code (docs, menus) can introspect without re-importing recharts.
 */
export const SUPPORTED_VISUAL_TYPES: ReadonlyArray<VisualSpec['type']> = [
  'kpi',
  'bar',
  'line',
  'area',
  'pie',
  'histogram',
  'scatter',
];
