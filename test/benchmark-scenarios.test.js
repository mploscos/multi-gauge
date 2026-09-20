import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BENCHMARK_PROFILES,
    benchmarkGauge,
    benchmarkValue
} from '../benchmark/scenarios.js';

test('benchmark profiles keep instrument type, signal, unit and range coherent', () => {
    const engineTemperature = BENCHMARK_PROFILES.find(({ label }) =>
        label === 'ENGINE TEMPERATURE');
    const tyrePressure = BENCHMARK_PROFILES.find(({ label }) =>
        label === 'FRONT LEFT TYRE PRESSURE');
    const heading = BENCHMARK_PROFILES.find(({ label }) => label === 'HEADING');

    assert.deepEqual(
        [engineTemperature.type, engineTemperature.orientation, engineTemperature.unit],
        ['linear', 'vertical', '°C']
    );
    assert.deepEqual(
        [tyrePressure.type, tyrePressure.orientation, tyrePressure.unit, tyrePressure.max],
        ['linear', 'horizontal', 'bar', 4]
    );
    assert.deepEqual(
        [heading.type, heading.min, heading.max, heading.unit],
        ['compass', 0, 360, undefined]
    );

    for (const profile of BENCHMARK_PROFILES) {
        if (profile.type === 'compass') {
            assert.match(profile.label, /HEADING|COURSE/);
            assert.equal(profile.unit, undefined);
        }
        if (profile.type === 'status') {
            assert.ok(profile.states.length >= 2);
            assert.equal(profile.unit, undefined);
            assert.equal(profile.bands, undefined);
            assert.equal(profile.markers, undefined);
        }
    }
});

test('sixteen single-gauge panels cycle through profiles instead of repeating speed', () => {
    const gauges = Array.from({ length: 16 }, (_, panelIndex) =>
        benchmarkGauge(panelIndex, 0, 1));
    assert.equal(new Set(gauges.map(({ id }) => id)).size, 16);
    assert.ok(new Set(gauges.map(({ label }) => label)).size >= BENCHMARK_PROFILES.length);
    assert.ok(gauges.some(({ type }) => type === 'compass'));
    assert.ok(gauges.some(({ type }) => type === 'status'));
});

test('generated benchmark values respect numeric ranges and configured status states', () => {
    for (let profileIndex = 0; profileIndex < BENCHMARK_PROFILES.length; profileIndex += 1) {
        const profile = BENCHMARK_PROFILES[profileIndex];
        for (const tick of [0, 17, 123]) {
            const value = benchmarkValue(0, profileIndex, BENCHMARK_PROFILES.length, tick, 30);
            if (profile.type === 'status') {
                assert.ok(profile.states.some((state) => Object.is(state.value, value)));
            } else {
                assert.ok(value >= profile.min && value <= profile.max);
            }
        }
    }
});
