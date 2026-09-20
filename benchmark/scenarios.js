export const BENCHMARK_PROFILES = Object.freeze([
    {
        type: 'arc', label: 'SPEED', unit: 'km/h', min: 0, max: 300,
        bands: [
            { from: 0, to: 160, kind: 'normal', label: 'CRUISE' },
            { from: 240, to: 300, kind: 'critical' }
        ],
        markers: [{ id: 'target', value: 145, label: 'TARGET' }]
    },
    {
        type: 'arc', label: 'ENGINE RPM', unit: 'r/min', min: 0, max: 8000,
        bands: [
            { from: 6000, to: 7000, kind: 'warning' },
            { from: 7000, to: 8000, kind: 'critical', label: 'REDLINE' }
        ]
    },
    {
        type: 'linear', orientation: 'vertical', mode: 'fill-marker',
        label: 'ENGINE TEMPERATURE', unit: '°C', min: -40, max: 150,
        bands: [{ from: 105, to: 150, kind: 'critical', label: 'HOT' }]
    },
    {
        type: 'linear', orientation: 'horizontal', mode: 'fill-marker',
        label: 'FRONT LEFT TYRE PRESSURE', unit: 'bar', min: 0, max: 4,
        bands: [{ from: 1.8, to: 3.1, kind: 'normal', label: 'NOMINAL' }],
        markers: [{ id: 'nominal', value: 2.4 }]
    },
    {
        type: 'compass', label: 'HEADING', min: 0, max: 360,
        markers: [{ id: 'course', value: 270, label: 'COURSE' }]
    },
    {
        type: 'linear', orientation: 'horizontal', mode: 'fill',
        label: 'MAIN BATTERY', unit: '%', min: 0, max: 100,
        bands: [
            { from: 0, to: 15, kind: 'critical' },
            { from: 15, to: 30, kind: 'warning', label: 'LOW' }
        ]
    },
    {
        type: 'linear', orientation: 'horizontal', mode: 'fill-marker',
        label: 'HYDRAULIC PRESSURE', unit: 'bar', min: 0, max: 300,
        markers: [{ id: 'nominal', value: 220 }]
    },
    {
        type: 'arc', label: 'REAR WHEEL TEMPERATURE', unit: '°C', min: -20, max: 160,
        bands: [{ from: 115, to: 160, kind: 'critical', label: 'HOT' }]
    },
    {
        type: 'arc', label: 'DRIVE TORQUE', unit: 'N·m', min: -400, max: 400,
        bands: [{ from: 300, to: 400, kind: 'warning' }]
    },
    {
        type: 'linear', orientation: 'vertical', mode: 'marker',
        label: 'CONTROL LATENCY', unit: 'µs', min: 0, max: 1000,
        bands: [{ from: 750, to: 1000, kind: 'critical', label: 'HIGH' }]
    },
    {
        type: 'status', label: 'SYSTEM STATUS',
        states: [
            { value: 0, label: 'OFF', kind: 'inactive' },
            { value: 1, label: 'ACTIVE', kind: 'normal' },
            { value: 2, label: 'FAULT', kind: 'critical' }
        ]
    },
    {
        type: 'status', label: 'MAIN CONTACTOR',
        states: [
            { value: false, label: 'OPEN', kind: 'inactive' },
            { value: true, label: 'CLOSED', kind: 'normal' }
        ]
    }
]);

function cloneItems(items) {
    return items?.map((item) => ({ ...item }));
}

export function benchmarkProfileIndex(panelIndex, gaugeIndex, gaugesPerPanel) {
    return panelIndex * gaugesPerPanel + gaugeIndex;
}

export function benchmarkGauge(panelIndex, gaugeIndex, gaugesPerPanel) {
    const profileIndex = benchmarkProfileIndex(panelIndex, gaugeIndex, gaugesPerPanel);
    const profile = BENCHMARK_PROFILES[profileIndex % BENCHMARK_PROFILES.length];
    return {
        ...profile,
        id: `signal-${panelIndex}-${gaugeIndex}`,
        info: profileIndex % 3 === 0 ? `Channel ${profileIndex + 1}` : undefined,
        bands: cloneItems(profile.bands),
        markers: cloneItems(profile.markers),
        states: cloneItems(profile.states)
    };
}

export function benchmarkValue(panelIndex, gaugeIndex, gaugesPerPanel, tick, rate) {
    const profileIndex = benchmarkProfileIndex(panelIndex, gaugeIndex, gaugesPerPanel);
    const profile = BENCHMARK_PROFILES[profileIndex % BENCHMARK_PROFILES.length];
    if (profile.type === 'status') {
        const stateIndex = Math.floor(tick / Math.max(1, rate) + profileIndex)
            % profile.states.length;
        return profile.states[stateIndex].value;
    }
    if (profile.type === 'compass') {
        return (tick * 2 + profileIndex * 37) % 360;
    }
    const midpoint = (profile.min + profile.max) / 2;
    const amplitude = (profile.max - profile.min) * 0.46;
    return midpoint + Math.sin(tick * 0.08 + profileIndex * 0.37) * amplitude;
}
