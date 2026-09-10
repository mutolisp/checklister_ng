/**
 * Chart dispatch for the in-app report view: `ReportChart` → the renderer for
 * its `kind`.
 *
 * Kinds land here together with the model code that constructs them, so a
 * chart can never be built that this switch cannot draw. The guard below is
 * for kinds that exist in the type but are not yet constructed anywhere; the
 * real protection is `check:report`, which walks every fixture report and
 * asserts each chart's kind is one the renderers handle. A silently dropped
 * chart is the failure mode this file exists to prevent — the `<w:drawing>`
 * bug shipped exactly that way once.
 */
import type { ReportChart } from '~/lib/reportTypes';
import { BarChartSvg } from './BarChartSvg';
import { ColumnChartSvg } from './ColumnChartSvg';
import { LineChartSvg } from './LineChartSvg';
import { ProfileChartSvg } from './ProfileChartSvg';

export function ReportChartView({ chart }: { chart: ReportChart }) {
  switch (chart.kind) {
    case 'bar':
      return <BarChartSvg chart={chart} />;
    case 'column':
      return <ColumnChartSvg chart={chart} />;
    case 'line':
      return <LineChartSvg chart={chart} />;
    case 'profile':
      return <ProfileChartSvg chart={chart} />;
    default: {
      // Exhaustive: a new kind must be handled here or this fails to compile,
      // which is the point of the discriminated union.
      const never: never = chart;
      return never;
    }
  }
}

export { BarChartSvg, ColumnChartSvg, LineChartSvg, ProfileChartSvg };
