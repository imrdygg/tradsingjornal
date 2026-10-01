import React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CoachPlan, CoachPlanGrade } from '../../types';
import {
  COACH_PLAN_GRADES,
  COACH_PLAN_GRADE_POINTS,
  buildCoachPlanGradeTrend,
  type CoachPlanGradePoint,
} from '../../lib/analytics/coach-plan-grades';

/**
 * The trader's grades of the coach's plans, plotted over time.
 *
 * One solid point per graded plan on an A-F axis, with a dashed cumulative average behind it.
 * The average is cumulative rather than a window so an early bad run does not pin the reading
 * down, and only graded plans are plotted: an ungraded plan has nothing to place.
 *
 * A single grade is not a trend, so nothing is drawn until there are at least two — the
 * caller's own average already says the same thing before that.
 */
export interface CoachPlanGradeTrendChartProps {
  plans: CoachPlan[];
  /** Wrapper id, so a host can anchor its own tests and layout. */
  id?: string;
  className?: string;
}

const GRADE_BY_POINT = new Map<number, CoachPlanGrade>(
  COACH_PLAN_GRADES.map((grade) => [COACH_PLAN_GRADE_POINTS[grade], grade])
);

const BAR_TONE: Record<CoachPlanGrade, string> = {
  A: 'bg-emerald-500',
  B: 'bg-lime-500',
  C: 'bg-amber-500',
  D: 'bg-orange-500',
  F: 'bg-rose-500',
};

/** The tooltip for the grade trend, naming the plan the point belongs to. */
const GradeTrendTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ payload?: CoachPlanGradePoint }>;
}> = ({ active, payload }) => {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[11px] font-mono space-y-1">
      <div className="text-zinc-300">
        {point.date} · {point.symbol}
      </div>
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-sm ${BAR_TONE[point.grade]}`} />
        <span className="text-zinc-400">Grade</span>
        <span className="font-bold text-zinc-100">{point.grade}</span>
      </div>
      <div className="text-zinc-500">Running average {point.runningAverage.toFixed(2)} of 4</div>
    </div>
  );
};

export const CoachPlanGradeTrendChart: React.FC<CoachPlanGradeTrendChartProps> = ({
  plans,
  id,
  className = '',
}) => {
  const trend = buildCoachPlanGradeTrend(plans);
  if (trend.length < 2) return null;

  return (
    <div id={id} className={className}>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis dataKey="label" stroke="#71717a" fontSize={10} tickLine={false} />
            <YAxis
              domain={[0, 4]}
              ticks={[0, 1, 2, 3, 4]}
              tickFormatter={(value) => GRADE_BY_POINT.get(Number(value)) ?? ''}
              stroke="#71717a"
              fontSize={10}
              tickLine={false}
              width={20}
            />
            <Tooltip content={<GradeTrendTooltip />} />
            <Line
              type="monotone"
              dataKey="points"
              name="Grade"
              stroke="#38bdf8"
              strokeWidth={2}
              dot={{ r: 3, fill: '#38bdf8' }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="runningAverage"
              name="Running average"
              stroke="#a1a1aa"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
