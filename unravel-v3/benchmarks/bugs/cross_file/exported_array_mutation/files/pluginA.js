import { registeredHandlers } from './registry.js';

export function initPluginA() {
    registeredHandlers.push({ name: 'pluginA', handler: () => console.log('A') });
}
