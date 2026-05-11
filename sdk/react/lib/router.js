import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useSentoriCtx } from './SentoriProvider.js';
/**
 * Subscribe to `react-router` navigation and push a `nav` breadcrumb
 * on every pathname/search/hash change. Mount once high in the tree
 * (inside the `Router` and inside `SentoriProvider`):
 *
 *     function AppShell() {
 *       useSentoriRouter()
 *       return <Outlet />
 *     }
 *
 * The first render does NOT emit a breadcrumb — only actual
 * transitions are recorded.
 *
 * Peer dependency: `react-router >= 7`. This hook is in a separate
 * entry point so apps not using react-router don't pay the import
 * cost or trip a missing-module error.
 */
export function useSentoriRouter() {
    const { addBreadcrumb } = useSentoriCtx();
    const location = useLocation();
    const prevRef = useRef(null);
    const next = location.pathname + location.search + location.hash;
    useEffect(() => {
        const prev = prevRef.current;
        if (prev !== null && prev !== next) {
            addBreadcrumb('nav', { from: prev, to: next });
        }
        prevRef.current = next;
    }, [addBreadcrumb, next]);
}
//# sourceMappingURL=router.js.map