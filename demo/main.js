import { MultiGauge } from '../src/index.js';

const error = document.querySelector('#error');

try {
    const vehicle = await MultiGauge.create(document.querySelector('#vehicle'), {
        grid: { rows: 4, columns: 4, gap: 8 },
        accent: '#00eaff',
        header: {
            icon: './assets/vehicle.svg',
            title: 'VEHICLE 01',
            subtitle: 'Prototype telemetry',
            badge: 'ONLINE'
        },
        gauges: [
            {
                id: 'speed', type: 'arc', label: 'SPEED', info: 'Vehicle', unit: 'km/h',
                min: 0, max: 300, row: 0, col: 0, rowSpan: 2, colSpan: 2,
                bands: [
                    { from: 0, to: 120, kind: 'normal'  },
                    { from: 120, to: 160, kind: 'cruise' },
                    { from: 240, to: 300, kind: 'critical', label: 'CRITICAL'  }
                ],
                markers: [{ id: 'target', value: 145, label: 'TARGET' }]
            },
            {
                id: 'rpm', type: 'arc', label: 'RPM', info: 'Engine', min: 0, max: 8000,
                unit: 'r/min', row: 0, col: 2, colSpan: 2,
                bands: [
                    { from: 0, to: 6000, kind: 'normal' },
                    { from: 6000, to: 7000, kind: 'warning' },
                    { from: 7000, to: 8000, kind: 'critical' }
                ],
                markers: [{ id: 'shift', value: 6800 }]
            },
            {
                id: 'temperature', type: 'linear', orientation: 'vertical', mode: 'fill-marker',
                label: 'ENGINE TEMPERATURE', info: 'Engine', min: -40, max: 150, unit: '°C', row: 1, col: 2,
                bands: [{ from: 105, to: 150, kind: 'critical' }]
            },
            {
                id: 'pressure', type: 'linear', orientation: 'horizontal', mode: 'fill-marker',
                label: 'FRONT LEFT TYRE PRESSURE', info: 'Wheel FL', min: 0, max: 4, unit: 'bar', row: 1, col: 3,
                markers: [{ id: 'nominal', value: 2.4 }]
            },
            { id: 'heading', type: 'compass', label: 'HEADING', row: 2, col: 0, colSpan: 2 },
            {
                id: 'battery', type: 'linear', orientation: 'horizontal', mode: 'fill',
                label: 'MAIN BATTERY VOLTAGE', info: 'Power bus A', min: 0, max: 100, unit: '%', row: 2, col: 2,
                bands: [{ from: 0, to: 15, kind: 'critical', label: 'CRITICAL' }, { from: 15, to: 30, kind: 'warning', label: 'WARNING' }]
            },
            {
                id: 'system', type: 'status', label: 'SYSTEM', row: 2, col: 3,
                states: [
                    { value: 0, label: 'OFF', kind: 'inactive' },
                    { value: 1, label: 'ACTIVE', kind: 'normal' },
                    { value: 2, label: 'FAULT', kind: 'critical' }
                ]
            },
            {
                id: 'hydraulic', type: 'linear', orientation: 'horizontal', mode: 'fill-marker',
                label: 'HYDRAULIC SYSTEM PRESSURE', info: 'Primary circuit',
                min: 0, max: 300, unit: 'bar', row: 3, col: 0, colSpan: 2,
                markers: [{ id: 'nominal', value: 220 }]
            },
            {
                id: 'rear-wheel', type: 'arc', label: 'REAR RIGHT WHEEL TEMPERATURE',
                info: 'Wheel RR', min: -20, max: 160, unit: '°C', row: 3, col: 2, colSpan: 2,
                bands: [{ from: 115, to: 160, kind: 'critical' }]
            }
        ]
    });

    const power = await MultiGauge.create(document.querySelector('#power'), {
        grid: { rows: 1, columns: 2, gap: 8 },
        accent: '#9d7bff',
        header: { title: 'POWER BUS B', subtitle: 'Independent canvas', badge: 'NOMINAL' },
        gauges: [
            { id: 'voltage', type: 'arc', label: 'MAIN BATTERY VOLTAGE', min: 0, max: 60, unit: 'V' },
            { id: 'contactor', type: 'status', label: 'CONTACTOR' }
        ]
    });
    globalThis.demoPanels = { vehicle, power };

    const started = performance.now();
    setInterval(() => {
        const time = (performance.now() - started) / 1000;
        vehicle.update({
            speed: 152 + Math.sin(time * 0.7) * 12,
            rpm: 4100 + Math.sin(time * 1.8) * 1700,
            temperature: 93.7 + Math.sin(time * 0.24) * 2,
            pressure: 2.5 + Math.sin(time * 0.9) * 0.08,
            heading: 243 + Math.sin(time * 0.18) * 12,
            battery: 68.6 + Math.sin(time * 0.12) * 2,
            hydraulic: 218 + Math.sin(time * 0.45) * 16,
            'rear-wheel': 72 + Math.sin(time * 0.36) * 9,
            system: Math.floor(time) % 23 === 0 ? 2 : 1
        });
        power.update({ voltage: 48 + Math.sin(time) * 2.3, contactor: true });
        const vehicleStats = vehicle.getStats();
        const powerStats = power.getStats();
        document.querySelector('#vehicle-renders').textContent = vehicleStats.renders;
        document.querySelector('#power-renders').textContent = powerStats.renders;
        document.querySelector('#runtime-generation').textContent = vehicleStats.runtimeGeneration;
    }, 33);
} catch (caught) {
    error.textContent = caught.message;
}
