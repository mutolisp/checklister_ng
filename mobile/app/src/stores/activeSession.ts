import { create } from 'zustand';
import { createSession, getActiveSession, endSession, type Session } from '~/db';

type ActiveSessionState = {
  session: Session | null;
  loading: boolean;
  refresh: () => void;
  start: () => Session;
  end: (id: number, updates?: { name?: string; project_id?: number; notes?: string }) => void;
};

export const useActiveSession = create<ActiveSessionState>((set, get) => ({
  session: null,
  loading: false,
  refresh: () => {
    set({ loading: true });
    const session = getActiveSession();
    set({ session, loading: false });
  },
  start: () => {
    const existing = get().session;
    if (existing) return existing;
    const id = createSession({});
    const session = getActiveSession();
    set({ session });
    return session!;
  },
  end: (id, updates) => {
    endSession(id, updates);
    set({ session: null });
  },
}));
