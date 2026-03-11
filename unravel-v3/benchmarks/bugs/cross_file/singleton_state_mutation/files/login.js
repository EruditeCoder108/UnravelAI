import store from './store.js';

export function login(userData, token) {
    store.user = userData;
    store.session.token = token;
    store.session.expiresAt = Date.now() + 3600000;
    store.preferences.theme = userData.preferredTheme || 'light';
}
