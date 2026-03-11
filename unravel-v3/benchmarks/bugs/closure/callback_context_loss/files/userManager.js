class UserManager {
    constructor() {
        this.users = [];
        this.currentUser = null;
    }

    loadUser(id) {
        fetch(`/api/users/${id}`)
            .then(r => r.json())
            .then(this.onUserLoaded);
    }

    onUserLoaded(data) {
        this.currentUser = data;
        this.users.push(data);
        console.log('Loaded:', this.currentUser);
    }
}

const manager = new UserManager();
manager.loadUser(1);
