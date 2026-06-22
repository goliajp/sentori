import { NavLink, Outlet, useParams } from 'react-router-dom';

/// Main app shell — sidebar + content outlet. Wraps every
/// authenticated page.
export function App() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function Sidebar() {
  // Sidebar layout mirrors the lens grouping from legacy
  // `web/src/modules/registry.tsx`: workspace-wide pages
  // up top, per-project pages picked when a project is
  // selected.
  const params = useParams<{ id?: string }>();
  const projectScoped = params.id;

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-6">
        <h1 className="text-base font-semibold tracking-tight text-zinc-100">
          Sentori
        </h1>
        <p className="font-mono text-[10px] text-zinc-600">v0.1</p>
      </div>

      <nav className="flex flex-1 flex-col gap-1 text-sm">
        <SectionLabel>Workspace</SectionLabel>
        <NavItem to="/" label="Overview" />
        <NavItem to="/alerts" label="Alerts" />
        <NavItem to="/audit" label="Audit" />
        <NavItem to="/settings" label="Settings" />
        <NavItem to="/health" label="Health" />

        {projectScoped && (
          <>
            <SectionLabel className="mt-6">Project</SectionLabel>
            <NavItem to={`/projects/${projectScoped}/issues`} label="Issues" />
            <NavItem to={`/projects/${projectScoped}/events`} label="Events" />
            <NavItem
              to={`/projects/${projectScoped}/cert`}
              label="Cert monitor"
            />
          </>
        )}
      </nav>
    </aside>
  );
}

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `rounded px-2.5 py-1.5 transition ${
          isActive
            ? 'bg-zinc-800 text-zinc-100'
            : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
        }`
      }
    >
      {label}
    </NavLink>
  );
}

function SectionLabel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`mb-1 px-2.5 text-[10px] font-medium uppercase tracking-wider text-zinc-600 ${className}`}
    >
      {children}
    </p>
  );
}
