import { on } from './eventBus.js';

function handleUserUpdate(data) {
    console.log('Notification: user updated', data);
    showNotification(`User ${data.name} updated`);
}

export function init() {
    on('user:update', handleUserUpdate);
}

function showNotification(msg) {
    document.getElementById('notifications').textContent = msg;
}
