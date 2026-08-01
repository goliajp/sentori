import { useSetThemeMode, useTheme, useThemeEffect } from '@goliapkg/gds/systems';
import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { CommandPalette } from './components/CommandPalette';
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

/// App shell — a narrow icon-free nav rail with exactly four
/// destinations (design.md §11: pages answer workflow questions),
/// the theme switch, the signed-in identity, and the content outlet.
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
    `block rounded-md px-3 py-1.5 text-sm transition-colors ${
      isActive
        ? 'bg-raised font-medium text-fg'
        : 'text-fg-muted hover:bg-raised/60 hover:text-fg'
    }`;

  return (
    <ShellContext.Provider value={{ me, projects, reloadProjects }}>
      <div className="flex h-screen overflow-hidden">
        <aside className="flex w-52 shrink-0 flex-col border-r border-border p-3">
          <div className="mb-6 px-3 pt-1">
            <span className="text-base font-semibold tracking-tight">sentori</span>
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
          <div className="mt-auto space-y-3 px-3 pb-1">
            <ThemeSwitch />
            <div className="text-xs text-fg-subtle">
              <div className="truncate">{me.email}</div>
              <div>
                {me.role === 'superadmin' ? t('shell.roleOwner') : t('shell.roleAdmin')}
              </div>
            </div>
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
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
