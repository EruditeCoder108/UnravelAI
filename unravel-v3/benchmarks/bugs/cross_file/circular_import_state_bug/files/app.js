import { setUser } from './userStore.js';
import { canDelete } from './permissionsStore.js';

setUser({ id: 1, role: 'admin', name: 'Alice' });
console.log(canDelete());
