/**
 * Tracks the latest active plot survey (status = 'active').
 *
 * Mirrors `useActiveSession` so the rest of the app can read the "is there
 * an active record of any kind?" state in one glance. Plots and sessions are
 * independent entities; both may be active simultaneously, and the unified
 * `<ActiveRecordBar />` decides what to display.
 */
import { create } from 'zustand';
import { getActivePlot, type PlotSurvey } from '~/db';

type ActivePlotState = {
  plot: PlotSurvey | null;
  refresh: () => void;
};

export const useActivePlot = create<ActivePlotState>((set) => ({
  plot: null,
  refresh: () => {
    set({ plot: getActivePlot() });
  },
}));
