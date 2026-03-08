const registry = new Map();

export function on(event, listener) {
    if (!registry.has(event)) registry.set(event, []);
    const ref = new WeakRef(listener);
    registry.get(event).push(ref);
}

export function off(event, listener) {
    if (!registry.has(event)) return;
    registry.set(
        event,
        registry.get(event).filter(ref => ref.deref() !== listener)
    );
}

export function emit(event, data) {
    if (!registry.has(event)) return;
    const alive = [];
    for (const ref of registry.get(event)) {
        const fn = ref.deref();
        if (fn) {
            fn(data);
            alive.push(ref);
        }
    }
    registry.set(event, alive);
}
