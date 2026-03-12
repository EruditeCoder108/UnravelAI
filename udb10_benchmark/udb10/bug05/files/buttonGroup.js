// buttonGroup.js — attaches click handlers to a group of buttons
export function initButtonGroup(container, buttons, onSelect) {
    const elements = [];

    for (let i = 0; i < buttons.length; i++) {
        const btn = document.createElement('button');
        btn.textContent = buttons[i].label;
        btn.dataset.id = buttons[i].id;

        // New handler function created on every loop iteration.
        // Each call to initButtonGroup adds ANOTHER handler to every button.
        btn.addEventListener('click', () => {
            onSelect(buttons[i].id);
        });

        container.appendChild(btn);
        elements.push(btn);
    }

    // Returns elements but no cleanup mechanism — listeners accumulate on re-init
    return elements;
}
