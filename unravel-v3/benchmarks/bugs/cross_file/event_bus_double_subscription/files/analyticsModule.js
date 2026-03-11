import { on } from './eventBus.js';

function trackUserUpdate(data) {
    console.log('Analytics: tracking user update', data.id);
    fetch('/api/analytics', { method: 'POST', body: JSON.stringify({ event: 'user_update', userId: data.id }) });
}

export function init() {
    on('user:update', trackUserUpdate);
}
