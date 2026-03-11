let cache = {};

export function setCache(key, value) {
    cache[key] = value;
}

export function clearCache() {
    cache = {};
}

export function getCache(key) {
    return cache[key];
}
