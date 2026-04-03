let _pool = null;
let _connectionCount = 0;
let _isInitialized = false;

export async function initPool(config = {}) {
    const size = config.size || 5;
    const timeout = config.timeout || 3000;

    _pool = {
        connections: [],
        size,
        timeout,
        createdAt: Date.now(),
    };

    for (let i = 0; i < size; i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
        _pool.connections.push({
            id: `conn-${i}`,
            status: 'ready',
            lastUsed: Date.now(),
        });
        _connectionCount++;
    }

    _isInitialized = true;
    return { poolSize: size, connections: _connectionCount };
}

export function getConnection() {
    if (!_isInitialized || !_pool) {
        throw new Error('Connection pool not initialized');
    }

    const ready = _pool.connections.find(c => c.status === 'ready');
    if (!ready) {
        throw new Error('No available connections');
    }

    ready.status = 'in-use';
    ready.lastUsed = Date.now();
    return ready;
}

export function releaseConnection(connId) {
    if (!_pool) return;
    const conn = _pool.connections.find(c => c.id === connId);
    if (conn) {
        conn.status = 'ready';
        conn.lastUsed = Date.now();
    }
}

export async function drainPool() {
    if (!_pool) return;
    for (const conn of _pool.connections) {
        conn.status = 'draining';
    }
    await new Promise(resolve => setTimeout(resolve, 50));
    _pool.connections = [];
    _isInitialized = false;
}

export function getPoolDiagnostics() {
    if (!_pool) return { initialized: false };
    return {
        initialized: _isInitialized,
        totalConnections: _pool.connections.length,
        readyConnections: _pool.connections.filter(c => c.status === 'ready').length,
        inUseConnections: _pool.connections.filter(c => c.status === 'in-use').length,
    };
}
