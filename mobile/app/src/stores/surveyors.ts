import { create } from 'zustand';
import {
  addSurveyor,
  listSurveyors,
  removeSurveyor,
  renameSurveyor,
  setSurveyorDefault,
  type Surveyor,
} from '~/db';

type SurveyorsState = {
  items: Surveyor[];
  loading: boolean;
  refresh: () => void;
  add: (name: string) => void;
  rename: (id: number, name: string) => void;
  remove: (id: number) => void;
  toggleDefault: (id: number, on: boolean) => void;
};

export const useSurveyors = create<SurveyorsState>((set, get) => ({
  items: [],
  loading: false,
  refresh: () => {
    set({ loading: true });
    set({ items: listSurveyors(), loading: false });
  },
  add: (name) => {
    addSurveyor(name);
    get().refresh();
  },
  rename: (id, name) => {
    renameSurveyor(id, name);
    get().refresh();
  },
  remove: (id) => {
    removeSurveyor(id);
    get().refresh();
  },
  toggleDefault: (id, on) => {
    setSurveyorDefault(id, on);
    get().refresh();
  },
}));
