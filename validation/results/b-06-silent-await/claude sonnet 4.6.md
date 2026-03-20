
Root Cause
The bug is in Application.bootstrap(). It calls db.init() without await:
tsasync bootstrap(): Promise<void> {
  this.db.init(); // ← fire-and-forget, connect() runs in the background
}
And DatabaseService.init() has the same problem internally:
tsasync init(): Promise<void> {
  this.connect(); // ← also not awaited, returns immediately
}
Both are unawaited async calls. bootstrap() resolves instantly while connect()'s 10–50ms TCP handshake is still in flight. On a fast dev machine the connection wins the race before any request arrives; on a cold production host it doesn't.
The isReady guard, UserRepository, and the stack trace are all correct and blameless. The comment in DatabaseService even says so explicitly: "fast enough that subsequent code 'just works' even without awaiting it".
Fix both missing awaits:
ts// DatabaseService.ts
async init(): Promise<void> {
  await this.connect(); // ← wait for TCP handshake to complete
  console.log('[DB] init() returned — connection established');
}

// Application.ts
async bootstrap(): Promise<void> {
  await this.db.init(); // ← wait for init() to fully resolve
  console.log('[App] Bootstrap complete — DB ready');
}
No changes needed anywhere else. Once bootstrap() properly resolves only after the connection is established, any code that correctly awaits bootstrap() before handling requests will never see DatabaseNotReadyError.