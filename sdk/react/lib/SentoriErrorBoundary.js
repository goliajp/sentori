import { jsx as _jsx } from "react/jsx-runtime";
import { Component } from 'react';
import { useSentoriCtx } from './SentoriProvider.js';
/**
 * Wraps `<SentoriErrorBoundaryInner>` so we can grab the capture
 * function from context — class components can't use hooks directly,
 * but they CAN receive props from a thin functional wrapper.
 */
export function SentoriErrorBoundary(props) {
    const { captureError } = useSentoriCtx();
    return (_jsx(SentoriErrorBoundaryInner, { ...props, capture: (err, info) => {
            captureError(err, { tags: { source: 'react.errorBoundary' } });
            props.onError?.(err, info);
        } }));
}
class SentoriErrorBoundaryInner extends Component {
    state = { error: null };
    static getDerivedStateFromError(error) {
        return { error };
    }
    componentDidCatch(error, info) {
        this.props.capture(error, info);
    }
    reset = () => this.setState({ error: null });
    render() {
        if (this.state.error) {
            return this.props.fallback({ error: this.state.error, reset: this.reset });
        }
        return this.props.children;
    }
}
//# sourceMappingURL=SentoriErrorBoundary.js.map