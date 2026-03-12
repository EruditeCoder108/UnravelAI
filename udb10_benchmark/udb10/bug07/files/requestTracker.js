// requestTracker.js — tracks in-flight requests globally
let _requestCount = 0;
let _errorCount = 0;

export function incrementRequest() {
    _requestCount++;
}

export function decrementRequest() {
    _requestCount--;
}

export function incrementError() {
    _errorCount++;
}

export function getStats() {
    return { active: _requestCount, errors: _errorCount };
}
