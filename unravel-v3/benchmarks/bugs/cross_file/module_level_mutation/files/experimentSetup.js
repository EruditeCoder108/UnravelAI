import { flags, enableFlag } from './featureFlags.js';

enableFlag('betaFeatures');
enableFlag('darkMode');

export const experimentConfig = { ...flags };
