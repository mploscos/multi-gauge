export const SEMANTIC_KINDS = Object.freeze([
    'normal',
    'warning',
    'critical',
    'inactive',
    'target'
]);

export const DEFAULT_THEME = Object.freeze({
    background: '#071014',
    surface: '#0c171d',
    surfaceRaised: '#102129',
    grid: '#1b3540',
    text: '#e7f7fa',
    muted: '#78909a',
    normal: '#41e6a1',
    warning: '#ffc857',
    critical: '#ff4d6d',
    inactive: '#40515a',
    target: '#f3f7a7'
});

/** Parse #rgb, #rrggbb, #rrggbbaa or a numeric RGBA array. */
export function color(value, alpha = 1) {
    if (Array.isArray(value)) {
        return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, (value[3] ?? 1) * alpha];
    }
    const hex = String(value ?? '#ffffff').replace('#', '');
    const expanded = hex.length === 3 ? [...hex].map((part) => part + part).join('') : hex;
    const parsed = Number.parseInt(expanded.slice(0, 8).padEnd(8, 'f'), 16);
    if (!Number.isFinite(parsed)) {
        return [1, 1, 1, alpha];
    }
    return [
        ((parsed >>> 24) & 255) / 255,
        ((parsed >>> 16) & 255) / 255,
        ((parsed >>> 8) & 255) / 255,
        (parsed & 255) / 255 * alpha
    ];
}

export function resolveTheme(theme = {}, accent = '#00eaff') {
    return { ...DEFAULT_THEME, ...theme, accent };
}

export function semanticColor(theme, kind, fallback = 'accent') {
    return color(theme[kind] ?? theme[fallback] ?? theme.accent);
}
