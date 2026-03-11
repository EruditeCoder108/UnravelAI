import { registeredHandlers } from './registry.js';

export function initPluginB() {
    registeredHandlers.push({ name: 'pluginB', handler: () => console.log('B') });
}
