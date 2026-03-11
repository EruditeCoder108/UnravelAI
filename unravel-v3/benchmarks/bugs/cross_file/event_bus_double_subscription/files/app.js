import { init as initNotifications } from './notificationModule.js';
import { init as initAnalytics } from './analyticsModule.js';

function setupModules() {
    initNotifications();
    initAnalytics();
    initNotifications();
}

setupModules();
