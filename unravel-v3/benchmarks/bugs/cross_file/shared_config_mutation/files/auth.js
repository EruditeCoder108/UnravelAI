import { appConfig } from './config.js';

export function initAuth(environment) {
    if (environment === 'staging') {
        appConfig.apiUrl = 'https://staging.example.com';
        appConfig.timeout = 10000;
    }
    return appConfig;
}
