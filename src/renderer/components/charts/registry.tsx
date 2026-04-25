import { useLayoutEffect, useRef, useState } from 'react';
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

const CHART_HEIGHT = 240;

function ChartCard({
  title,
  className,
  children,
  hint,
}: {
  title: string;
  className?: string;
  children: (size: { width: number; height: number }) => React.ReactNode;
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
       * Inline height avoids Tailwind JIT surprises and gives the
       * ResizeObserver in `SizedChart` a concrete parent to measure
       * synchronously on the first layout. `width: '100%'` pins to the
       * grid cell's resolved width.
       */}
      <div style={{ height: CHART_HEIGHT, width: '100%' }}>
        <SizedChart>{children}</SizedChart>
      </div>
    </div>
  );
}

/**
 * Replacement for recharts' `ResponsiveContainer`. The default
 * implementation delegates to a `ResizeObserver` that can fire with
 * `-1`/`0` dimensions during the first render inside flex/grid parents,
 * triggering the "width(0) and height(0) of chart should be greater
 * than 0" warning and rendering no bars.
 *
 * `SizedChart` instead measures the parent's resolved box via a ref and
 * keeps the latest size in React state. We only render children once a
 * positive (width, height) pair is known — so recharts always receives
 * a numeric, non-zero dimension and never logs the warning.
 */
function SizedChart({
  children,
}: {
  children: (size: { width: number; height: number }) => React.ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Seed with the synchronous layout dimensions so the first render
    // after mount already has real numbers.
    const rect = host.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    }
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box = entry.contentRect;
      if (box.width <= 0 || box.height <= 0) return;
      setSize({ width: Math.round(box.width), height: Math.round(box.height) });
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={hostRef} style={{ width: '100%', height: '100%' }}>
      {size ? children(size) : null}
    </div>
  );
}

/**
 * Rendered in place of a chart when the spec's data is empty or its
 * axis fields don't match the keys actually present on `spec.data`.
 * Without this, recharts silently renders a blank axis-and-gridlines
 * frame and the user can't tell whether the chart succeeded or failed.
 */
function ChartDataError({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-sm bg-background/40 p-3 text-center">
      <span className="text-[11px] font-semibold text-muted-foreground">
        Chart has no data
      </span>
      <span className="text-[10px] text-muted-foreground/80">{message}</span>
    </div>
  );
}

/**
 * Validate a Cartesian spec (bar/line/area/scatter) before recharts gets
 * a chance to render a silent empty chart. Returns an error message when
 * something's off, or `null` when the spec is renderable.
 */
function cartesianDataError(
  data: ReadonlyArray<Record<string, unknown>>,
  xField: string,
  yField: string,
): string | null {
  if (!Array.isArray(data) || data.length === 0) {
    return 'The model returned an empty data array for this chart.';
  }
  const first = data[0] ?? {};
  if (!(xField in first)) {
    return `Missing x-axis field "${xField}" on the data rows.`;
  }
  if (!(yField in first)) {
    return `Missing y-axis field "${yField}" on the data rows.`;
  }
  const yNumeric = data.some((row) => {
    const v = row[yField];
    return typeof v === 'number' && Number.isFinite(v);
  });
  if (!yNumeric) {
    return `The y-axis field "${yField}" has no numeric values.`;
  }
  return null;
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
  const err = cartesianDataError(spec.data, spec.xField, spec.yField);
  if (err) {
    return (
      <ChartCard title={spec.title}>
        {() => <ChartDataError message={err} />}
      </ChartCard>
    );
  }
  return (
    <ChartCard title={spec.title}>
      {({ width, height }) => (
        <BarChart
          width={width}
          height={height}
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
          <Bar dataKey={spec.yField} fill={PRIMARY} radius={[4, 4, 0, 0]} />
        </BarChart>
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Line                                                               */
/* ------------------------------------------------------------------ */

export function LineChartCard({ spec }: { spec: LineSpec }) {
  const err = cartesianDataError(spec.data, spec.xField, spec.yField);
  if (err) {
    return (
      <ChartCard title={spec.title}>
        {() => <ChartDataError message={err} />}
      </ChartCard>
    );
  }
  return (
    <ChartCard title={spec.title}>
      {({ width, height }) => (
        <LineChart
          width={width}
          height={height}
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
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Area                                                               */
/* ------------------------------------------------------------------ */

export function AreaChartCard({ spec }: { spec: AreaSpec }) {
  const err = cartesianDataError(spec.data, spec.xField, spec.yField);
  if (err) {
    return (
      <ChartCard title={spec.title}>
        {() => <ChartDataError message={err} />}
      </ChartCard>
    );
  }
  return (
    <ChartCard title={spec.title}>
      {({ width, height }) => (
        <AreaChart
          width={width}
          height={height}
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
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Pie                                                                */
/* ------------------------------------------------------------------ */

export function PieChartCard({ spec }: { spec: PieSpec }) {
  const err = cartesianDataError(spec.data, spec.labelField, spec.valueField);
  if (err) {
    return (
      <ChartCard title={spec.title}>
        {() => <ChartDataError message={err} />}
      </ChartCard>
    );
  }
  return (
    <ChartCard title={spec.title}>
      {({ width, height }) => (
        <PieChart width={width} height={height}>
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
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Histogram                                                          */
/* ------------------------------------------------------------------ */

export function HistogramChartCard({ spec }: { spec: HistogramSpec }) {
  if (!Array.isArray(spec.bins) || spec.bins.length === 0) {
    return (
      <ChartCard title={spec.title} hint={`field: ${spec.field}`}>
        {() => <ChartDataError message="The model returned no histogram bins." />}
      </ChartCard>
    );
  }
  return (
    <ChartCard title={spec.title} hint={`field: ${spec.field}`}>
      {({ width, height }) => (
        <BarChart
          width={width}
          height={height}
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
      )}
    </ChartCard>
  );
}

/* ------------------------------------------------------------------ */
/*  Scatter                                                            */
/* ------------------------------------------------------------------ */

export function ScatterChartCard({ spec }: { spec: ScatterSpec }) {
  const err = cartesianDataError(spec.data, spec.xField, spec.yField);
  if (err) {
    return (
      <ChartCard title={spec.title}>
        {() => <ChartDataError message={err} />}
      </ChartCard>
    );
  }
  return (
    <ChartCard title={spec.title}>
      {({ width, height }) => (
        <ScatterChart
          width={width}
          height={height}
          margin={{ top: 8, right: 12, bottom: 8, left: 8 }}
        >
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
      )}
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
