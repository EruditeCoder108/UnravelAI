import { initPluginA } from './pluginA.js';
import { initPluginB } from './pluginB.js';
import { getHandlers } from './registry.js';

initPluginA();
initPluginB();
initPluginA();

const handlers = getHandlers();
console.log(handlers.length);
