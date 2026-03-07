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
                    background: '#0a0a0a',
                    border: '2px solid #ff003c',
                    padding: '24px',
                    margin: '20px',
                    fontFamily: 'Consolas, monospace',
                    color: '#ccc',
                }}>
                    <h3 style={{ color: '#ff003c', margin: '0 0 12px', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '2px' }}>
                        ⚠️ Report Rendering Failed
                    </h3>
                    <p style={{ color: '#888', fontSize: '13px', marginBottom: '16px' }}>
                        The analysis completed but the report could not be rendered. This is usually caused by unexpected data in a Mermaid diagram.
                        The raw result is shown below — you can copy it.
                    </p>
                    {this.props.rawResult && (
                        <>
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(JSON.stringify(this.props.rawResult, null, 2));
                                    this.setState({ copied: true });
                                    setTimeout(() => this.setState({ copied: false }), 2000);
                                }}
                                style={{
                                    background: 'rgba(204,255,0,0.1)',
                                    border: '1px solid #ccff00',
                                    color: '#ccff00',
                                    padding: '8px 16px',
                                    cursor: 'pointer',
                                    fontFamily: 'Consolas, monospace',
                                    fontSize: '12px',
                                    marginBottom: '12px',
                                }}
                            >
                                {this.state.copied ? '✅ Copied!' : '📋 Copy Raw JSON'}
                            </button>
                            <pre style={{
                                background: '#050505',
                                border: '1px solid #2a2a2a',
                                padding: '14px',
                                fontSize: '11px',
                                maxHeight: '400px',
                                overflow: 'auto',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                color: '#00ffff',
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
