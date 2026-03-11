import store from './store.js';

export function updateTheme(theme) {
    store.preferences.theme = theme;
}

export function getPreferences() {
    return store.preferences;
}
