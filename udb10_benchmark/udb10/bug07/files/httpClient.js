// httpClient.js — wraps fetch with request tracking
import { incrementRequest, decrementRequest, incrementError } from './requestTracker.js';

export async function trackedFetch(url, options = {}) {
    incrementRequest();

    try {
        const res = await fetch(url, options);

        if (!res.ok) {
            incrementError();
            // BUG: decrementRequest() is never called on HTTP error responses.
            // _requestCount keeps growing. After enough failed requests the
            // loading indicator permanently shows "requests in flight".
            throw new Error(`HTTP ${res.status}`);
        }

        decrementRequest();
        return res.json();
    } catch (err) {
        // Network errors also skip decrementRequest — caught here after re-throw
        // or on fetch() itself failing
        incrementError();
        throw err;
    }
}
