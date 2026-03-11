import { currentUser } from './userStore.js';

const rolePermissions = {
    admin: ['read', 'write', 'delete'],
    user: ['read'],
};

export function getPermissions(role) {
    return rolePermissions[role] || [];
}

export function canDelete() {
    return currentUser?.permissions?.includes('delete');
}
