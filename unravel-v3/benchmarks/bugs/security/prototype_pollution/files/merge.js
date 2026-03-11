function deepMerge(target, source) {
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object') {
            if (!target[key]) target[key] = {};
            deepMerge(target[key], source[key]);
        } else {
            target[key] = source[key];
        }
    }
    return target;
}

function applyUserSettings(defaultSettings, userInput) {
    return deepMerge(defaultSettings, userInput);
}

const settings = applyUserSettings(
    { theme: 'light', lang: 'en' },
    JSON.parse('{"__proto__": {"isAdmin": true}}')
);

console.log({}.isAdmin);
