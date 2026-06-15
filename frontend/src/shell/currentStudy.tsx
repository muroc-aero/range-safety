import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/* The last-opened study, kept so the nav rail's "study" entry and the top-bar
   breadcrumb stay meaningful after navigating away (mirrors the kit's pinned
   current study). Persisted to sessionStorage so a refresh keeps it. */

export interface CurrentStudy {
  key: string;
  label: string;
  version: number | null;
}

interface Ctx {
  study: CurrentStudy | null;
  setStudy: (s: CurrentStudy | null) => void;
}

const StudyContext = createContext<Ctx>({ study: null, setStudy: () => {} });
const STORAGE_KEY = 'rs.currentStudy';

function load(): CurrentStudy | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CurrentStudy) : null;
  } catch {
    return null;
  }
}

export function CurrentStudyProvider({ children }: { children: ReactNode }) {
  const [study, setStudyState] = useState<CurrentStudy | null>(load);
  const setStudy = useCallback((s: CurrentStudy | null) => {
    setStudyState(s);
    try {
      if (s) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* sessionStorage unavailable — in-memory only */
    }
  }, []);
  const value = useMemo(() => ({ study, setStudy }), [study, setStudy]);
  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>;
}

export function useCurrentStudy(): Ctx {
  return useContext(StudyContext);
}
