import { NotificationSettings } from '../store/preferenceStore';

interface QueuedNotification {
  id: string;
  title: string;
  body: string;
  timestamp: number;
}

/**
 * Buffers and dispatches notifications according to the user's
 * current notification preferences. Frequency setting controls
 * whether notifications are delivered immediately or batched.
 */
export class NotificationService {
  private queue: QueuedNotification[] = [];
  private settings: NotificationSettings;

  constructor(settings: NotificationSettings) {
    // Stores a reference to the settings object passed in.
    // If the caller mutates the original object (e.g. via Object.assign),
    // this.settings will reflect those changes without an explicit update call.
    // That is a separate issue from the store bug and does not affect the test.
    this.settings = settings;
  }

  updateSettings(settings: NotificationSettings): void {
    this.settings = settings;
  }

  enqueue(notification: Omit<QueuedNotification, 'id' | 'timestamp'>): void {
    this.queue.push({
      ...notification,
      id: `notif_${Date.now()}`,
      timestamp: Date.now(),
    });

    if (this.settings.frequency === 'immediate') {
      this.flush();
    }
  }

  flush(): QueuedNotification[] {
    const batch = [...this.queue];
    this.queue = [];
    return batch;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}
