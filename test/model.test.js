import test from 'node:test';
import assert from 'node:assert/strict';
import {
    clamp,
    coerceValue,
    normalizeGauge,
    normalizeValue,
    projectBand,
    resolveBand,
    resolveStatus,
    serializeGauge,
    setGaugeMarker
} from '../src/model/GaugeModel.js';

test('normalizes and clamps scalar values', () => {
    const gauge = normalizeGauge({ id: 'rpm', type: 'arc', label: 'Engine speed', min: 0, max: 8000 });
    assert.equal(gauge.label, 'Engine speed');
    assert.equal(coerceValue(gauge, 9000), 8000);
    assert.equal(coerceValue(gauge, -1), 0);
    assert.equal(normalizeValue(gauge, 4000), 0.5);
    assert.equal(clamp(12, 0, 10), 10);
});

test('compass wraps and cyclic bands split around zero', () => {
    const gauge = normalizeGauge({ id: 'hdg', type: 'compass' });
    assert.equal(coerceValue(gauge, 361), 1);
    assert.equal(coerceValue(gauge, -1), 359);
    assert.equal(normalizeValue(gauge, 90), 0.25);
    assert.deepEqual(projectBand({ from: 350, to: 20 }, 0, 360, true), [[350, 360], [0, 20]]);
    assert.deepEqual(projectBand({ from: 10, to: 20 }, 0, 100), [[10, 20]]);
});

test('active bands support cyclic ranges and give later overlaps precedence', () => {
    const gauge = normalizeGauge({
        id: 'hdg',
        type: 'compass',
        value: 355,
        bands: [
            { from: 300, to: 20, kind: 'normal' },
            { from: 350, to: 10, kind: 'warning' }
        ]
    });
    assert.equal(resolveBand(gauge)?.kind, 'warning');
    assert.equal(resolveBand(gauge, 15)?.kind, 'normal');
    assert.equal(resolveBand(gauge, 180), null);
});

test('markers update in place or append', () => {
    const gauge = normalizeGauge({ id: 'speed', markers: [{ id: 'v1', value: 110 }] });
    setGaugeMarker(gauge, 'v1', 115, { label: 'V1' });
    setGaugeMarker(gauge, 'vr', 125);
    assert.deepEqual(gauge.markers, [
        { id: 'v1', value: 115, label: 'V1' },
        { id: 'vr', value: 125 }
    ]);
});

test('status resolves exact, numeric boolean and fallback values', () => {
    const gauge = normalizeGauge({
        id: 'radar',
        type: 'status',
        states: [
            { value: 0, label: 'OFF' },
            { value: 1, label: 'ACTIVE' },
            { value: 2, label: 'FAULT', kind: 'critical' }
        ]
    });
    assert.equal(resolveStatus(gauge, true).label, 'ACTIVE');
    assert.equal(resolveStatus(gauge, 'missing').label, 'OFF');
    assert.equal(coerceValue(gauge, 2), 2);
    const booleanGauge = normalizeGauge({ id: 'ready', type: 'status' });
    assert.equal(resolveStatus(booleanGauge, 1).value, true);
    assert.equal(coerceValue(booleanGauge, false), false);
});

test('gauge serialization contains public state and round-trips', () => {
    const gauge = normalizeGauge({
        id: 'temp', type: 'linear', orientation: 'vertical', mode: 'fill-marker',
        min: -40, max: 150, bands: [{ from: 100, to: 150, kind: 'critical' }]
    });
    const serialized = serializeGauge(gauge, { row: 1, col: 2, rowSpan: 2, colSpan: 1 });
    assert.equal(JSON.parse(JSON.stringify(serialized)).orientation, 'vertical');
    assert.equal(normalizeGauge(serialized).bands[0].kind, 'critical');
    assert.equal('device' in serialized, false);
});
