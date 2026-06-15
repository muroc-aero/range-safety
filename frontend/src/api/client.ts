/* Typed fetch wrappers over the dashboard read-model API (/api/*).
   Same origin in production (the SPA is served by the Starlette app); proxied
   to a local uvicorn in dev (see vite.config.ts). */
import type {
  MachineDef,
  PlanView,
  ReasoningView,
  ReportView,
  RequirementsView,
  ResultsView,
  RunKey,
  RunRef,
  StateProjection,
  ServerStatus,
  StudyKey,
  StudyListItem,
  StudyView,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The viewer is not logged in (OIDC session expired / absent). */
  get isAuth(): boolean {
    return this.status === 401;
  }

  /** Authenticated, but not permitted to see this study. */
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

/** A study/run key is a single path segment; encode it so the colon and any
    reserved chars survive the round trip (the ASGI server percent-decodes
    before route matching). */
function seg(key: string): string {
  return encodeURIComponent(key);
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => undefined);
    }
    const detail =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : res.statusText;
    throw new ApiError(`${res.status} ${detail}`, res.status, body);
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const api = {
  // -- enumeration (SPA-only endpoints, added in app.py) --------------------
  listStudies(opts: { src?: string; q?: string } = {}): Promise<StudyListItem[]> {
    return getJSON<StudyListItem[]>(`/studies${qs({ src: opts.src, q: opts.q })}`);
  },
  listRuns(studyKey: StudyKey): Promise<RunRef[]> {
    return getJSON<RunRef[]>(`/runs/${seg(studyKey)}`);
  },
  servers(): Promise<ServerStatus[]> {
    return getJSON<ServerStatus[]>('/servers');
  },

  // -- machine definition (static: states + forward/feedback edges) ---------
  machine(): Promise<MachineDef> {
    return getJSON<MachineDef>('/machine');
  },

  // -- study-scoped views ---------------------------------------------------
  state(key: StudyKey): Promise<StateProjection> {
    return getJSON<StateProjection>(`/state/${seg(key)}`);
  },
  requirements(key: StudyKey, version?: number): Promise<RequirementsView> {
    return getJSON<RequirementsView>(`/requirements/${seg(key)}${qs({ version })}`);
  },
  plan(key: StudyKey, version?: number): Promise<PlanView> {
    return getJSON<PlanView>(`/plan/${seg(key)}${qs({ version })}`);
  },
  reasoning(key: StudyKey, focus?: string): Promise<ReasoningView> {
    return getJSON<ReasoningView>(`/reasoning/${seg(key)}${qs({ focus })}`);
  },
  study(key: StudyKey): Promise<StudyView> {
    return getJSON<StudyView>(`/study/${seg(key)}`);
  },
  report(key: StudyKey, version?: number): Promise<ReportView> {
    return getJSON<ReportView>(`/report/${seg(key)}${qs({ version })}`);
  },

  // -- run-scoped views -----------------------------------------------------
  results(runKey: RunKey): Promise<ResultsView> {
    return getJSON<ResultsView>(`/results/${seg(runKey)}`);
  },
  plotTypes(runKey: RunKey): Promise<string[]> {
    return getJSON<string[]>(`/plots/${seg(runKey)}`);
  },
  /** PNG endpoint URL for an <img src>. Not fetched as JSON. */
  plotImageUrl(runKey: RunKey, plotType: string): string {
    return `/api/plots/${seg(runKey)}/${encodeURIComponent(plotType)}`;
  },

  // -- study trade-grid plots ----------------------------------------------
  studyPlotTypes(key: StudyKey): Promise<string[]> {
    return getJSON<string[]>(`/study-plots/${seg(key)}`);
  },
  studyPlotImageUrl(key: StudyKey, plotType: string, style = 'paper'): string {
    return `/api/study-plots/${seg(key)}/${encodeURIComponent(plotType)}${qs({ style })}`;
  },
};
