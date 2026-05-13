import { create } from 'zustand';

export type ToastAction = {
  label: string;
  onPress: () => void;
};

type ToastEntry = {
  id: number;
  message: string;
  action?: ToastAction;
  durationMs: number;
  createdAt: number;
};

type ToastState = {
  current: ToastEntry | null;
  show: (message: string, opts?: { action?: ToastAction; durationMs?: number }) => void;
  dismiss: () => void;
};

let nextId = 1;

export const useToast = create<ToastState>((set) => ({
  current: null,
  show: (message, opts = {}) => {
    const id = nextId++;
    const entry: ToastEntry = {
      id,
      message,
      action: opts.action,
      durationMs: opts.durationMs ?? 5000,
      createdAt: Date.now(),
    };
    set({ current: entry });
    setTimeout(() => {
      set((state) => (state.current?.id === id ? { current: null } : state));
    }, entry.durationMs);
  },
  dismiss: () => set({ current: null }),
}));
