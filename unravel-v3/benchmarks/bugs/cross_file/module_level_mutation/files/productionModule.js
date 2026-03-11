import { flags } from './featureFlags.js';
import './experimentSetup.js';

export function isAnalyticsEnabled() {
    return flags.analytics;
}

export function isBetaEnabled() {
    return flags.betaFeatures;
}
