class ModalViewer {
    constructor() {
        this.overlay = document.getElementById('modal-overlay');
        this.openBtn = document.getElementById('openModal');
        this.closeBtn = document.getElementById('closeModal');
        this.logEl = document.getElementById('log');

        this.openBtn.addEventListener('click', () => this.open());
        this.closeBtn.addEventListener('click', () => this.close());
    }

    log(msg) {
        this.logEl.innerHTML += `<div>${msg}</div>`;
        this.logEl.scrollTop = this.logEl.scrollHeight;
    }

    open() {
        this.overlay.classList.add('active');
        this.log('Modal opened.');

        // BUG: Using .bind(this) creates a BRAND NEW function instance in memory.
        // It does not refer to the existing prototype method.
        document.addEventListener('keydown', this.handleKey.bind(this));
    }

    close() {
        this.overlay.classList.remove('active');
        this.log('Modal closed.');

        // BUG: Since .bind(this) is called again, this creates another brand new function instance.
        // removeEventListener won't find a match, so the event listener is NEVER removed.
        // It leaks memory and fires multiple times if opened and closed repeatedly.
        document.removeEventListener('keydown', this.handleKey.bind(this));
    }

    handleKey(e) {
        this.log(`Key pressed: ${e.key}`);
        if (e.key === 'Escape') {
            this.close();
        }
    }
}

// Initialize
const viewer = new ModalViewer();
