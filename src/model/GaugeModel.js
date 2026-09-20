import { MultiGaugeError } from '../errors.js';

export const GAUGE_TYPES = new Set(['arc', 'linear', 'compass', 'status']);
export const LINEAR_MODES = new Set(['fill', 'marker', 'fill-marker']);
export const ORIENTATIONS = new Set(['horizontal', 'vertical']);

const DEFAULT_STATUS_STATES = [
    { value: false, label: 'OFF', kind: 'inactive' },
    { value: true, label: 'ON', kind: 'normal' }
];

function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function cloneItems(items = []) {
    return items.map((item) => ({ ...item }));
}

/** Clamp a number to an inclusive range. */
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/** Normalize a scalar to 0..1. Compass values wrap instead of clamping. */
export function normalizeValue(gauge, value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return 0;
    }
    if (gauge.type === 'compass') {
        const range = gauge.max - gauge.min;
        return range > 0 ? (((number - gauge.min) % range) + range) % range / range : 0;
    }
    return (clamp(number, gauge.min, gauge.max) - gauge.min) / (gauge.max - gauge.min);
}

/** Split a possibly wrapping band into monotonically increasing intervals. */
export function projectBand(band, min, max, cyclic = false) {
    const from = clamp(finite(Number(band.from), min), min, max);
    const to = clamp(finite(Number(band.to), max), min, max);
    if (cyclic && from > to) {
        return [[from, max], [min, to]];
    }
    return [[Math.min(from, to), Math.max(from, to)]];
}

/** Resolve the active band, giving later declarations precedence when bands overlap. */
export function resolveBand(gauge, value = gauge.value) {
    if (gauge.type === 'status') {
        return null;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return null;
    }
    const current = gauge.type === 'compass'
        ? gauge.min + normalizeValue(gauge, number) * (gauge.max - gauge.min)
        : clamp(number, gauge.min, gauge.max);
    for (let index = gauge.bands.length - 1; index >= 0; index -= 1) {
        const band = gauge.bands[index];
        const segments = projectBand(band, gauge.min, gauge.max, gauge.type === 'compass');
        if (segments.some(([from, to]) => current >= from && current <= to)) {
            return band;
        }
    }
    return null;
}

/** Resolve a public status value to its configured state. */
export function resolveStatus(gauge, value) {
    const direct = gauge.states.find((state) => Object.is(state.value, value));
    if (direct) {
        return direct;
    }
    if (typeof value === 'boolean') {
        const numeric = gauge.states.find((state) => state.value === Number(value));
        if (numeric) {
            return numeric;
        }
    }
    if (typeof value === 'number') {
        const boolean = gauge.states.find((state) => typeof state.value === 'boolean'
            && Number(state.value) === value);
        if (boolean) {
            return boolean;
        }
    }
    return gauge.states[0];
}

/** Convert public gauge configuration to the stable internal CPU model. */
export function normalizeGauge(input) {
    if (!input || typeof input !== 'object') {
        throw new MultiGaugeError('Gauge configuration must be an object.');
    }
    if (typeof input.id !== 'string' || input.id.length === 0) {
        throw new MultiGaugeError('Every gauge needs a non-empty string id.');
    }
    const type = input.type ?? 'arc';
    if (!GAUGE_TYPES.has(type)) {
        throw new MultiGaugeError(`Unknown gauge type: ${type}.`);
    }

    const min = finite(Number(input.min), type === 'compass' ? 0 : 0);
    const max = finite(Number(input.max), type === 'compass' ? 360 : 100);
    if (max <= min) {
        throw new MultiGaugeError(`Gauge "${input.id}" requires max greater than min.`);
    }
    const orientation = ORIENTATIONS.has(input.orientation) ? input.orientation : 'horizontal';
    const mode = LINEAR_MODES.has(input.mode) ? input.mode : 'fill';
    const states = cloneItems(input.states?.length ? input.states : DEFAULT_STATUS_STATES);
    const gauge = {
        id: input.id,
        type,
        label: String(input.label ?? input.id),
        info: String(input.info ?? ''),
        unit: String(input.unit ?? ''),
        min,
        max,
        value: input.value ?? (type === 'status' ? states[0].value : min),
        orientation,
        mode,
        startAngle: finite(Number(input.startAngle), -135),
        endAngle: finite(Number(input.endAngle), 135),
        bands: cloneItems(input.bands),
        markers: cloneItems(input.markers),
        states,
        row: Number.isInteger(input.row) ? input.row : undefined,
        col: Number.isInteger(input.col) ? input.col : undefined,
        rowSpan: Math.max(1, Math.trunc(finite(Number(input.rowSpan), 1))),
        colSpan: Math.max(1, Math.trunc(finite(Number(input.colSpan), 1)))
    };
    gauge.value = coerceValue(gauge, gauge.value);
    return gauge;
}

/** Coerce a runtime value without changing the gauge definition. */
export function coerceValue(gauge, value) {
    if (gauge.type === 'status') {
        return resolveStatus(gauge, value).value;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return gauge.value ?? gauge.min;
    }
    if (gauge.type === 'compass') {
        const range = gauge.max - gauge.min;
        return (((number - gauge.min) % range) + range) % range + gauge.min;
    }
    return clamp(number, gauge.min, gauge.max);
}

/** Add or update a marker while retaining a serializable plain object. */
export function setGaugeMarker(gauge, id, value, patch = {}) {
    const index = gauge.markers.findIndex((marker) => marker.id === id);
    const marker = { ...(index >= 0 ? gauge.markers[index] : {}), ...patch, id, value };
    if (index >= 0) {
        gauge.markers[index] = marker;
    } else {
        gauge.markers.push(marker);
    }
    return marker;
}

/** Strip internal state and undefined values from a gauge. */
export function serializeGauge(gauge, placement) {
    const result = {
        id: gauge.id,
        type: gauge.type,
        label: gauge.label,
        info: gauge.info,
        unit: gauge.unit,
        min: gauge.min,
        max: gauge.max,
        value: gauge.value,
        row: placement.row,
        col: placement.col,
        rowSpan: placement.rowSpan,
        colSpan: placement.colSpan,
        bands: cloneItems(gauge.bands),
        markers: cloneItems(gauge.markers)
    };
    if (gauge.type === 'linear') {
        result.orientation = gauge.orientation;
        result.mode = gauge.mode;
    }
    if (gauge.type === 'arc') {
        result.startAngle = gauge.startAngle;
        result.endAngle = gauge.endAngle;
    }
    if (gauge.type === 'status') {
        result.states = cloneItems(gauge.states);
    }
    return result;
}
