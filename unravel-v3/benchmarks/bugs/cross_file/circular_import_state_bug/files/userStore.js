import { getPermissions } from './permissionsStore.js';

export let currentUser = null;

export function setUser(user) {
    currentUser = user;
    currentUser.permissions = getPermissions(user.role);
}
