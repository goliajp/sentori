import { type ErrorInfo, type ReactNode } from 'react';
type Props = {
    children: ReactNode;
    /** Rendered after an error is caught. Receives the error and a
     *  `reset` callback that clears the boundary so retries can run. */
    fallback: (props: {
        error: Error;
        reset: () => void;
    }) => ReactNode;
    /** Optional additional logging hook. Runs after Sentori capture. */
    onError?: (error: Error, info: ErrorInfo) => void;
};
/**
 * Wraps `<SentoriErrorBoundaryInner>` so we can grab the capture
 * function from context — class components can't use hooks directly,
 * but they CAN receive props from a thin functional wrapper.
 */
export declare function SentoriErrorBoundary(props: Props): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=SentoriErrorBoundary.d.ts.map