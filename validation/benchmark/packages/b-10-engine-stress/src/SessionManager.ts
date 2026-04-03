// SessionManager.ts
// Manages active user sessions and inactivity timeouts.
// BUG 3: Stale closure — setTimeout captures `currentSession` by reference
//         but `currentSession` is reassigned on logout, leaving the timer
//         operating on the old (garbage) session object.
// BUG 4: Orphan listener — 'visibilitychange' added to document, never removed.

export type UserSession = {
    userId: string;
    cartTotal: number;
    expiresAt: number;
};

let currentSession: UserSession | null = null;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min

export function startSession(userId: string, cartTotal: number): UserSession {
    currentSession = {
        userId,
        cartTotal,
        expiresAt: Date.now() + SESSION_TTL_MS,
    };

    // BUG 3 (STALE CLOSURE): the arrow function captures `currentSession` by
    // reference at the time of creation. When logout() is called, currentSession
    // is set to null. After SESSION_TTL_MS, this callback fires and tries to
    // access `currentSession.userId` — but `currentSession` is now null.
    // The let binding was reassigned; the closure holds the old stale reference.
    const capturedSession = currentSession;
    setTimeout(() => {
        // Developer thought `capturedSession` is safe — it is.
        // But they also read `currentSession` directly inside:
        if (currentSession && currentSession.userId === capturedSession.userId) {
            // this check passes even after logout if a new session was started
            // with the same userId (ghost authentication)
            expireSession(currentSession.userId);
        }
    }, SESSION_TTL_MS);

    // BUG 4 (ORPHAN LISTENER): added on every startSession() call.
    // After logout/re-login, another listener is stacked. They are never removed.
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return currentSession;
}

function handleVisibilityChange() {
    if (document.hidden && currentSession) {
        console.log(`[session] Tab hidden — pausing session for ${currentSession.userId}`);
    }
}

function expireSession(userId: string) {
    if (currentSession?.userId === userId) {
        currentSession = null;
        console.log(`[session] Session expired for ${userId}`);
    }
}

export function logout(): void {
    // BUG 3 payoff: sets currentSession to null, but the setTimeout
    // callback from startSession() is still pending in the event loop.
    // If a new login happens before the timer fires, the timer sees a
    // DIFFERENT currentSession and may expire a valid session.
    currentSession = null;
}

export function getSession(): UserSession | null {
    return currentSession;
}
