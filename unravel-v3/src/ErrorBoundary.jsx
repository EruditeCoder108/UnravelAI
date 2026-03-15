import React from 'react';

/**
 * React Error Boundary — catches rendering crashes in the report panel.
 * Shows a fallback UI with the raw JSON instead of a white screen.
 */
export class ReportErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('[Unravel] Report rendering crashed:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    background: 'var(--surface-base)',
                    border: '1px solid var(--accent-red)',
                    padding: '32px',
                    borderRadius: 'var(--radius-lg)',
                    margin: '20px',
                    fontFamily: 'inherit',
                    color: 'var(--text-primary)',
                    backdropFilter: 'var(--blur-md)',
                    WebkitBackdropFilter: 'var(--blur-md)'
                }}>
                    <h3 style={{ color: 'var(--accent-red)', margin: '0 0 16px', fontSize: '16px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <ShieldAlert size={20} /> Report Rendering Failed
                    </h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '24px', lineHeight: 1.6 }}>
                        The analysis completed but the report could not be rendered. This is usually caused by unexpected data in a Mermaid diagram.
                        The raw result is shown below for recovery.
                    </p>
                    {this.props.rawResult && (
                        <>
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(JSON.stringify(this.props.rawResult, null, 2));
                                    this.setState({ copied: true });
                                    setTimeout(() => this.setState({ copied: false }), 2000);
                                }}
                                className="matte-button"
                                style={{
                                    marginBottom: '16px',
                                    background: this.state.copied ? 'var(--accent-green)22' : 'var(--surface-hover)',
                                    color: this.state.copied ? 'var(--accent-green)' : 'var(--text-primary)',
                                    borderColor: this.state.copied ? 'var(--accent-green)' : 'var(--border-light)'
                                }}
                            >
                                {this.state.copied ? '✅ COPIED' : '📋 COPY RAW JSON'}
                            </button>
                            <pre style={{
                                background: 'var(--surface-solid)',
                                border: '1px solid var(--border-light)',
                                padding: '20px',
                                fontSize: '11px',
                                maxHeight: '400px',
                                borderRadius: 'var(--radius-md)',
                                overflow: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                color: 'var(--text-tertiary)',
                            }}>
                                {JSON.stringify(this.props.rawResult, null, 2)}
                            </pre>
                        </>
                    )}
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        style={{
                            background: 'rgba(34,197,94,0.1)',
                            border: '1px solid #22c55e',
                            color: '#22c55e',
                            padding: '8px 16px',
                            cursor: 'pointer',
                            fontFamily: 'Consolas, monospace',
                            fontSize: '12px',
                            marginTop: '12px',
                        }}
                    >
                        🔄 Try Re-rendering
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
