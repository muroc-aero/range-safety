import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { ApiError } from '../api/client';
import { Callout } from '../design';

/* Consistent loading / error / empty states for routed views. Auth (401) and
   forbidden (403) get distinct, honest messages rather than a generic error. */

export function Loading({ label = 'loading' }: { label?: string }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 9, padding: '40px 32px',
        fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-400)',
      }}
    >
      <Loader2 size={15} className="rs-spin" /> {label}…
      <style>{`@keyframes rs-spin{to{transform:rotate(360deg)}}.rs-spin{animation:rs-spin .9s linear infinite}`}</style>
    </div>
  );
}

export function ErrorState({ error }: { error: Error }) {
  const api = error instanceof ApiError ? error : null;
  if (api?.isAuth) {
    // The content routes are wrapped by the browser-OIDC decorator, which
    // redirects a top-level GET through the IdP and back. A full navigation to
    // the current path (not an XHR) re-enters that flow and returns here once
    // authenticated.
    const here = `${location.pathname}${location.search}`;
    return (
      <div style={{ padding: '32px' }}>
        <Callout tone="warn" title="not signed in">
          Your dashboard session has expired or is absent.{' '}
          <a href={here}>Sign in</a> to continue.
        </Callout>
      </div>
    );
  }
  if (api?.isForbidden) {
    return (
      <div style={{ padding: '32px' }}>
        <Callout tone="warn" title="not authorized">
          You do not have access to this study.
        </Callout>
      </div>
    );
  }
  return (
    <div style={{ padding: '32px' }}>
      <Callout tone="error" title="error">
        {error.message}
      </Callout>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        padding: '40px 32px', fontFamily: 'var(--font-sans)', fontSize: 14,
        color: 'var(--ink-400)', lineHeight: 1.6, maxWidth: 620,
      }}
    >
      {children}
    </div>
  );
}
