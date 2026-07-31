// Cmd+K — jump anywhere without leaving the keyboard. Four nav
// targets plus a live search over open issues by title. Deliberately
// small: this is a lift, not a query language.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { KindBadge } from './kind';
import { useT } from '../i18n';
import { api, type IssueSummary } from '../lib/api';

type Item =
  | { type: 'nav'; label: string; to: string }
  | { type: 'issue'; issue: IssueSummary };

export function CommandPalette() {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open/close reset state at the transition point, not in an effect.
  const setOpenReset = (next: boolean | ((o: boolean) => boolean)) =>
    setOpen((o) => {
      const n = typeof next === 'function' ? next(o) : next;
      if (n !== o) {
        setQuery('');
        setCursor(0);
      }
      return n;
    });

  // Global shortcut: Cmd+K / Ctrl+K toggles, Escape closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpenReset((o) => !o);
      } else if (e.key === 'Escape') {
        setOpenReset(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // setOpenReset is identity-stable enough for a mount-lifetime listener
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch the open-issue set once per palette opening; filtering is
  // client-side from there so arrows stay instant.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    let alive = true;
    api
      .listIssues({ status: 'open', limit: 200 })
      .then((r) => {
        if (alive) setIssues(r.issues);
      })
      .catch(() => {
        // palette search degrades to nav-only; the page itself
        // surfaces load errors
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const nav: Item[] = (
      [
        [t('nav.inbox'), '/'],
        [t('nav.instruments'), '/instruments'],
        [t('nav.releases'), '/releases'],
        [t('nav.settings'), '/settings'],
      ] as const
    )
      .filter(([label]) => !q || label.toLowerCase().includes(q))
      .map(([label, to]) => ({ type: 'nav', label, to }));
    const hits: Item[] = q
      ? issues
          .filter(
            (i) =>
              i.title.toLowerCase().includes(q) ||
              (i.messageSample ?? '').toLowerCase().includes(q),
          )
          .slice(0, 8)
          .map((issue) => ({ type: 'issue', issue }))
      : [];
    return [...nav, ...hits];
  }, [query, issues, t]);

  if (!open) return null;

  const go = (item: Item) => {
    setOpenReset(false);
    navigate(item.type === 'nav' ? item.to : `/issues/${item.issue.id}`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[18vh]"
      onClick={() => setOpenReset(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-[var(--gds-border,#2a2a30)] bg-[var(--gds-surface,#17171c)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => Math.min(c + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (e.key === 'Enter' && items[cursor]) {
              e.preventDefault();
              go(items[cursor]);
            }
          }}
          placeholder={t('palette.placeholder')}
          className="w-full border-b border-[var(--gds-border,#2a2a30)] bg-transparent px-4 py-3 text-sm outline-none"
        />
        <div className="max-h-72 overflow-y-auto py-1">
          {items.length === 0 && (
            <div className="px-4 py-6 text-center text-sm opacity-40">
              {t('table.empty')}
            </div>
          )}
          {items.map((item, idx) => (
            <button
              key={item.type === 'nav' ? item.to : item.issue.id}
              type="button"
              onClick={() => go(item)}
              onMouseEnter={() => setCursor(idx)}
              className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                idx === cursor ? 'bg-[var(--gds-surface-raised,#26262c)]' : ''
              }`}
            >
              {item.type === 'nav' ? (
                <span>{item.label}</span>
              ) : (
                <>
                  <KindBadge kind={item.issue.kind} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{item.issue.title}</span>
                    {item.issue.messageSample && (
                      <span className="ml-2 opacity-50">
                        {item.issue.messageSample}
                      </span>
                    )}
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
