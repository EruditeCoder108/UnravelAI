class Modal {
    constructor(id) {
        this.id = id;
        this.element = document.getElementById(id);
        this.setupListeners();
    }

    setupListeners() {
        document.addEventListener('keydown', this.handleKeyDown.bind(this));
        window.addEventListener('resize', this.handleResize.bind(this));
    }

    handleKeyDown(e) {
        if (e.key === 'Escape') this.close();
    }

    handleResize() {
        this.reposition();
    }

    close() {
        this.element.style.display = 'none';
    }

    reposition() {
        this.element.style.top = `${window.innerHeight / 2}px`;
    }

    destroy() {
        this.element.remove();
    }
}
