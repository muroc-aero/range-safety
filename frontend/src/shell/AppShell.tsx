import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  FolderOpen,
  GitFork,
  LineChart,
  Server,
  Settings,
  Folder,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BrandMark, StatusPill } from '../design';
import { useCurrentStudy } from './currentStudy';

/* Persistent product chrome: 54px top bar (brand + breadcrumb + status) and a
   64px Lucide icon rail. Wraps the routed views via <Outlet/>. Ported from
   ui_kits/range-safety/AppShell.jsx, wired to react-router + real state. */

interface NavItem {
  id: string;
  icon: LucideIcon;
  label: string;
  to: string;
  matchPrefix: string;
}

const ICON = 18;

export function AppShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { study } = useCurrentStudy();

  const studyTo = study ? `/study/${encodeURIComponent(study.key)}` : '/';
  const provTo = study
    ? `/provenance/${encodeURIComponent(study.key)}`
    : '/provenance';

  const nav: NavItem[] = [
    { id: 'studies', icon: FolderOpen, label: 'studies', to: '/', matchPrefix: '/' },
    {
      id: 'study',
      icon: LineChart,
      label: study?.label ?? 'study',
      to: studyTo,
      matchPrefix: '/study',
    },
    {
      id: 'provenance',
      icon: GitFork,
      label: 'provenance',
      to: provTo,
      matchPrefix: '/provenance',
    },
    { id: 'servers', icon: Server, label: 'servers', to: '/servers', matchPrefix: '/servers' },
  ];

  const isActive = (item: NavItem) =>
    item.matchPrefix === '/'
      ? pathname === '/'
      : pathname.startsWith(item.matchPrefix);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--app-canvas)' }}>
      <header
        style={{
          height: 54, flex: 'none', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', padding: '0 18px',
          background: 'var(--app-panel)', borderBottom: '1px solid var(--app-line)', zIndex: 5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <BrandMark size="sm" wordmark="RANGE-SAFETY" />
          <span style={{ width: 1, height: 22, background: 'var(--app-line)' }} />
          {study ? (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-400)', display: 'flex', alignItems: 'center', gap: 7 }}>
              <Folder size={13} /> {study.label}
              {study.version != null ? (
                <>
                  <span style={{ color: 'var(--ink-300)' }}>/</span>
                  <span style={{ color: 'var(--ink-600)' }}>v{study.version}</span>
                </>
              ) : null}
            </span>
          ) : (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-300)' }}>
              verification &amp; validation
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <StatusPill status="ok">dashboard online</StatusPill>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <nav
          style={{
            width: 64, flex: 'none', background: 'var(--app-panel)',
            borderRight: '1px solid var(--app-line)', display: 'flex',
            flexDirection: 'column', alignItems: 'center', padding: '14px 0', gap: 4,
          }}
        >
          {nav.map((n) => {
            const active = isActive(n);
            const Glyph = n.icon;
            return (
              <button
                key={n.id}
                onClick={() => navigate(n.to)}
                title={n.label}
                style={{
                  width: 44, height: 44, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', border: 'none', borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  background: active ? 'var(--blue-50)' : 'transparent',
                  color: active ? 'var(--blue-700)' : 'var(--ink-400)',
                }}
              >
                <Glyph size={ICON} />
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <button
            title="settings"
            style={{
              width: 44, height: 44, display: 'flex', alignItems: 'center',
              justifyContent: 'center', border: 'none', background: 'transparent',
              color: 'var(--ink-300)', cursor: 'pointer',
            }}
          >
            <Settings size={ICON} />
          </button>
        </nav>
        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
