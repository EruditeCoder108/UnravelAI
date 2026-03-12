// settingsStore.js — manages local settings state with auto-save
import { saveSettings } from './settingsService.js';

let _settings = {};
let _userId = null;
let _saveInProgress = false;

export function initStore(userId, initialSettings) {
    _userId = userId;
    _settings = { ...initialSettings };
}

export function updateSetting(key, value) {
    _settings[key] = value;
    // Trigger async save — does not wait, does not debounce
    autoSave();
}

async function autoSave() {
    if (_saveInProgress) {
        // BUG: if a save is in progress, new changes are silently dropped.
        // The check exits immediately — the updated _settings are never saved.
        return;
    }

    _saveInProgress = true;
    try {
        // Takes a snapshot of _settings at the time of call.
        // But _settings may have been updated again while this awaits.
        await saveSettings(_userId, { ..._settings });
    } finally {
        _saveInProgress = false;
        // Does NOT check if _settings changed during the save — those changes are lost.
    }
}

export function getSettings() {
    return { ..._settings };
}
