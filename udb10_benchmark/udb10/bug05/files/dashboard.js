// dashboard.js — re-initializes the button group on data refresh
import { initButtonGroup } from './buttonGroup.js';

let activeButtons = [];

export function refreshDashboard(container, newButtons, onSelect) {
    // Clear the container visually
    container.innerHTML = '';

    // Re-initialize with new button data.
    // Problem: old button DOM nodes are removed, but if any were reused
    // or the container is the same element, event listeners from prior
    // initButtonGroup calls on surviving elements accumulate.
    activeButtons = initButtonGroup(container, newButtons, onSelect);
}

// Called on every data poll — every 5 seconds in production
export function startPolling(container, fetchButtons, onSelect) {
    setInterval(async () => {
        const buttons = await fetchButtons();
        refreshDashboard(container, buttons, onSelect);
    }, 5000);
}
