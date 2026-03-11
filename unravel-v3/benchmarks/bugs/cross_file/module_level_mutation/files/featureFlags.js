export const flags = {
    darkMode: false,
    betaFeatures: false,
    analytics: true
};

export function enableFlag(name) {
    flags[name] = true;
}
