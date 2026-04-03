// notification-hub.js
// A lightweight pub/sub hub that routes events to subscriber callbacks.
//
// Bug: NotificationHub.broadcast() calls this._subscribers.forEach() and inside
// the callback calls this._promote() when a subscriber has been flagged as
// priority. _promote() does:
//   this._subscribers.delete(id)
//   this._subscribers.add(id)       <-- re-inserts at tail
//
// Per ECMAScript §24.2.3.7 (Set.prototype.forEach), any value deleted and
// then re-added before the iteration completes WILL be visited again at its
// new tail position. This means a "priority" subscriber gets its callback
// fired TWICE in one broadcast — every time broadcast() is called.
//
// This is a silent correctness bug: no exception, no warning.
// Symptoms: duplicate notifications, double-charged event handlers, counters
// that drift, UI that renders twice per user action.

class SubscriberRecord {
    constructor(id, fn, priority = false) {
        this.id       = id;
        this.fn       = fn;
        this.priority = priority;
        this.promoted = false;
    }
}

export class NotificationHub {
    constructor() {
        this._subscribers = new Set();   // Set<subscriberId: string>
        this._registry    = new Map();   // subscriberId -> SubscriberRecord
        this._fired       = 0;
    }

    subscribe(id, fn, priority = false) {
        const record = new SubscriberRecord(id, fn, priority);
        this._registry.set(id, record);
        this._subscribers.add(id);
    }

    unsubscribe(id) {
        this._subscribers.delete(id);
        this._registry.delete(id);
    }

    // BUG CASE 1 (DIRECT — easiest for detector):
    // Mutation happens inline inside the forEach callback itself.
    broadcastDirect(event) {
        this._subscribers.forEach(id => {
            const record = this._registry.get(id);
            if (!record) return;
            if (record.priority && !record.promoted) {
                record.promoted = true;
                // Direct delete+add — should fire detector at depth 0
                this._subscribers.delete(id);
                this._subscribers.add(id);
            }
            record.fn(event);
            this._fired++;
        });
    }

    // BUG CASE 2 (VIA HELPER — mirrors raft-node's pattern exactly):
    // Mutation is inside a helper method called from the callback.
    // Requires depth-1 expansion to detect.
    broadcast(event) {
        this._subscribers.forEach(id => {
            const record = this._registry.get(id);
            if (!record) return;
            if (record.priority && !record.promoted) {
                this._promote(id);   // <-- depth-1: delete+add inside here
            }
            record.fn(event);
            this._fired++;
        });
    }

    _promote(id) {
        const record = this._registry.get(id);
        if (!record || record.promoted) return;
        record.promoted = true;
        // Exactly mirrors VoteManager._refreshVoterRecord:
        this._subscribers.delete(id);   // remove from current Set position
        this._subscribers.add(id);      // re-insert at tail → double-visit
    }

    firedCount() { return this._fired; }

    getDiagnostics() {
        return {
            subscriberCount: this._subscribers.size,
            fired:           this._fired,
            registry: [...this._registry.entries()].map(([id, r]) => ({
                id,
                priority: r.priority,
                promoted: r.promoted,
            })),
        };
    }
}
