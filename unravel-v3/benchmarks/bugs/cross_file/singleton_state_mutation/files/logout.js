import store from './store.js';

export function logout() {
    store.user = null;
    store.session.token = null;
    store.session.expiresAt = null;
}
