import { useSetThemeMode, useTheme, useThemeEffect } from '@goliapkg/gds/systems';
import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { CommandPalette, openPalette } from './components/CommandPalette';
import { useT } from './i18n';
import { api, type Me, type Project } from './lib/api';
import type { ThemeMode } from './lib/theme';

/// Shell context: who is logged in + which projects are visible.
/// Pages read the project scope from here instead of re-fetching.
export type Shell = {
  me: Me;
  projects: Project[];
  reloadProjects: () => void;
};

const ShellContext = createContext<Shell | null>(null);

export function useShell(): Shell {
  const s = useContext(ShellContext);
  if (!s) throw new Error('useShell outside <App>');
  return s;
}

/// App frame — this is an application, not a document: a fixed
/// viewport split into a nav rail, a slim topbar (search, theme,
/// identity) and a content region that panes scroll inside of. The
/// page never scrolls as a whole.
export function App() {
  const t = useT();
  const [me, setMe] = useState<Me | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  useThemeEffect();

  useEffect(() => {
    // Boot probe: a 401 inside api.authMe() redirects to /login.
    api.authMe().then(setMe, () => undefined);
  }, []);

  const reloadProjects = () => {
    api.listProjects().then((r) => setProjects(r.projects), () => undefined);
  };
  useEffect(() => {
    if (me) reloadProjects();
  }, [me]);

  if (!me) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-fg-subtle">
        {t('shell.loading')}
      </div>
    );
  }

  const navCls = ({ isActive }: { isActive: boolean }) =>
    `block rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
      isActive
        ? 'bg-raised font-medium text-fg'
        : 'text-fg-muted hover:bg-raised/60 hover:text-fg'
    }`;

  return (
    <ShellContext.Provider value={{ me, projects, reloadProjects }}>
      <div className="flex h-screen overflow-hidden bg-canvas">
        <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-bg p-2.5">
          <div className="mb-5 px-2.5 pt-1.5">
            <span className="text-[15px] font-semibold tracking-tight">sentori</span>
          </div>
          <nav className="flex flex-col gap-0.5">
            <NavLink to="/" end className={navCls}>
              {t('nav.inbox')}
            </NavLink>
            <NavLink to="/instruments" className={navCls}>
              {t('nav.instruments')}
            </NavLink>
            <NavLink to="/releases" className={navCls}>
              {t('nav.releases')}
            </NavLink>
            <NavLink to="/settings" className={navCls}>
              {t('nav.settings')}
            </NavLink>
          </nav>
          <div className="mt-auto px-1 pb-1">
            <ThemeSwitch />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-bg px-4">
            <button
              type="button"
              onClick={openPalette}
              className="flex h-7 w-72 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-[13px] text-fg-subtle transition-colors hover:border-border-strong hover:text-fg-muted"
            >
              <span aria-hidden>⌕</span>
              <span className="min-w-0 flex-1 truncate text-left">
                {t('palette.placeholder')}
              </span>
              <kbd className="rounded border border-border px-1 font-mono text-[10px]">⌘K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-fg-subtle">
                {me.email}
                <span className="ml-1.5 text-fg-subtle/70">
                  {me.role === 'superadmin' ? t('shell.roleOwner') : t('shell.roleAdmin')}
                </span>
              </span>
            </div>
          </header>
          <main className="min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
        <CommandPalette />
      </div>
    </ShellContext.Provider>
  );
}

/// Three-state theme switch. GDS owns the state + persistence; this
/// is just the smallest possible handle on it — a segmented row that
/// reads as furniture, not as a feature.
function ThemeSwitch() {
  const t = useT();
  const theme = useTheme();
  const setMode = useSetThemeMode();
  const options: { mode: ThemeMode; label: string; glyph: string }[] = [
    { mode: 'system', label: t('theme.system'), glyph: '◐' },
    { mode: 'light', label: t('theme.light'), glyph: '○' },
    { mode: 'dark', label: t('theme.dark'), glyph: '●' },
  ];
  return (
    <div
      role="radiogroup"
      aria-label={t('theme.label')}
      className="flex rounded-md border border-border p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.mode}
          type="button"
          role="radio"
          aria-checked={theme.mode === o.mode}
          title={o.label}
          aria-label={o.label}
          onClick={() => setMode(o.mode)}
          className={`flex-1 rounded py-1 text-center text-xs transition-colors ${
            theme.mode === o.mode
              ? 'bg-raised text-fg'
              : 'text-fg-subtle hover:text-fg-muted'
          }`}
        >
          {o.glyph}
        </button>
      ))}
    </div>
  );
}
