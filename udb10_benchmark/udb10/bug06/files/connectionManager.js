// connectionManager.js — manages a WebSocket connection with auto-reconnect
export function createConnectionManager(url, onMessage) {
    let socket = null;
    let reconnectTimer = null;

    function connect() {
        // Schedule a reconnect attempt BEFORE creating the socket.
        // reconnectTimer captures the value of socket at this point — which is null.
        reconnectTimer = setTimeout(() => {
            if (socket && socket.readyState !== WebSocket.OPEN) {
                console.log('Reconnecting...');
                socket.close();
                connect();
            } else if (!socket) {
                // socket is null here — this branch always runs on first timeout
                // because the closure captured socket = null before assignment below
                connect();
            }
        }, 5000);

        // socket is assigned AFTER the setTimeout callback closes over it
        socket = new WebSocket(url);

        socket.onmessage = (event) => {
            onMessage(JSON.parse(event.data));
        };

        socket.onerror = () => {
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connect, 1000);
        };
    }

    return { connect, disconnect: () => {
        clearTimeout(reconnectTimer);
        if (socket) socket.close();
    }};
}
