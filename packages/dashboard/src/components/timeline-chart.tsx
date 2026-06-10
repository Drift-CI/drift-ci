import type { JSX } from 'react';
import type { TimelinePoint } from '@/lib/queries';
import { formatScore } from '@/lib/format';

interface TimelineChartProps {
  points: readonly TimelinePoint[];
  /** Optional regression threshold to draw as a dashed reference line. */
  threshold?: number;
  /** Highlight the point matching this runId (the run currently being viewed). */
  highlightRunId?: string;
}

const VIEW_W = 720;
const VIEW_H = 160;
const PADDING = { top: 12, right: 12, bottom: 24, left: 36 };

/**
 * Hand-rolled SVG sparkline. Avoids a recharts dep (~120 KB) since
 * we only need a single series and a threshold reference. Y-axis is
 * always [0, 1] to keep score deltas visually comparable across cases.
 */
export function TimelineChart({
  points,
  threshold,
  highlightRunId,
}: TimelineChartProps): JSX.Element {
  if (points.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white p-4 text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
        No history yet — this is the first recorded score for this case.
      </div>
    );
  }

  const innerW = VIEW_W - PADDING.left - PADDING.right;
  const innerH = VIEW_H - PADDING.top - PADDING.bottom;

  // X positions: evenly spaced — runs aren't necessarily uniform in
  // time but a uniform x-axis reads better for sparse/irregular data.
  // (Time-axis switch is a future polish item.)
  const xs =
    points.length === 1
      ? [PADDING.left + innerW / 2]
      : points.map(
          (_, i) => PADDING.left + (innerW * i) / (points.length - 1),
        );
  const ys = points.map((p) => {
    const clamped = Number.isFinite(p.score) ? Math.min(1, Math.max(0, p.score)) : 0;
    return PADDING.top + innerH * (1 - clamped);
  });

  const path = xs
    .map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${ys[i].toFixed(1)}`)
    .join(' ');

  const thresholdY =
    typeof threshold === 'number' && Number.isFinite(threshold)
      ? PADDING.top + innerH * threshold
      : null;

  const lastIdx = points.length - 1;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 flex items-baseline justify-between text-xs text-neutral-500 dark:text-neutral-400">
        <span className="font-medium uppercase tracking-wide">Score timeline</span>
        <span className="font-mono">
          {points.length} run(s) · latest {formatScore(points[lastIdx].score)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label="Score over time"
        className="h-40 w-full text-neutral-300 dark:text-neutral-700"
      >
        {/* Y-axis gridlines at 0, 0.5, 1.0 */}
        {[0, 0.5, 1].map((g) => {
          const y = PADDING.top + innerH * (1 - g);
          return (
            <g key={g}>
              <line
                x1={PADDING.left}
                x2={PADDING.left + innerW}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth="0.5"
                strokeDasharray={g === 0 || g === 1 ? '0' : '2 4'}
              />
              <text
                x={PADDING.left - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-current font-mono text-[10px]"
              >
                {g.toFixed(1)}
              </text>
            </g>
          );
        })}

        {thresholdY != null ? (
          <line
            x1={PADDING.left}
            x2={PADDING.left + innerW}
            y1={thresholdY}
            y2={thresholdY}
            className="stroke-amber-500 dark:stroke-amber-400"
            strokeWidth="0.75"
            strokeDasharray="3 3"
          />
        ) : null}

        <path
          d={path}
          className="fill-none stroke-sky-600 dark:stroke-sky-400"
          strokeWidth="1.5"
        />

        {points.map((p, i) => (
          <circle
            key={p.runId}
            cx={xs[i]}
            cy={ys[i]}
            r={p.runId === highlightRunId ? 4 : 2.5}
            className={
              p.runId === highlightRunId
                ? 'fill-sky-700 stroke-white dark:fill-sky-300 dark:stroke-neutral-900'
                : 'fill-sky-500 dark:fill-sky-400'
            }
            strokeWidth={p.runId === highlightRunId ? 1.5 : 0}
          >
            <title>
              {`${p.capturedAt.toISOString()} — score ${formatScore(p.score)}`}
            </title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
