# MultiGauge

> A fast WebGPU instrument panel for realtime signals.

MultiGauge displays multiple telemetry gauges in a responsive grid. It is a JavaScript ESM package with no runtime dependencies and accepts data from any source, including WebSocket, SSE, browser sensors and simulations.

![MultiGauge vehicle telemetry dashboard](./docs/multigauge-demo.png)

## Requirements

- A browser with WebGPU support.
- A canvas with a visible width and height.
- A secure context when required by the browser.

## Installation

```sh
npm install multi-gauge
```

## Quick start

```html
<canvas id="instruments"></canvas>

<style>
    #instruments {
        display: block;
        width: 100%;
        height: 600px;
    }
</style>
```

```js
import { MultiGauge } from 'multi-gauge';

const panel = await MultiGauge.create(document.querySelector('#instruments'), {
    grid: { rows: 2, columns: 3, gap: 8 },
    accent: '#00eaff',
    gauges: [
        {
            id: 'speed',
            type: 'arc',
            label: 'SPEED',
            min: 0,
            max: 300,
            unit: 'km/h',
            bands: [
                { from: 0, to: 160, kind: 'normal' },
                { from: 240, to: 300, kind: 'critical', label: 'LIMIT' }
            ],
            markers: [
                { id: 'target', value: 145, kind: 'target', label: 'TARGET' }
            ]
        },
        {
            id: 'temperature',
            type: 'linear',
            label: 'TEMPERATURE',
            min: -40,
            max: 150,
            unit: '°C'
        },
        { id: 'heading', type: 'compass', label: 'HEADING' },
        { id: 'radar', type: 'status', label: 'RADAR' }
    ]
});

panel.update({
    speed: 127,
    temperature: 86,
    heading: 182,
    radar: true
});
```

## Gauge types

| Type | Use |
| --- | --- |
| `arc` | A scalar value displayed on a radial scale. |
| `linear` | A horizontal or vertical scalar gauge. |
| `compass` | A cyclic heading. Values wrap between `min` and `max`. |
| `status` | A boolean, numeric or string state. |

Every gauge requires a unique `id`. Common options include:

| Option | Description |
| --- | --- |
| `label` | Primary gauge label. Defaults to `id`. |
| `info` | Optional secondary information. |
| `unit` | Unit displayed with the value. |
| `min`, `max` | Numeric range. Defaults to `0` and `100`; compass defaults to `0..360`. |
| `value` | Initial value. |
| `row`, `col` | Zero-based grid position. Omit both for automatic placement. |
| `rowSpan`, `colSpan` | Number of occupied grid cells. Defaults to `1`. |
| `bands` | Semantic ranges for arc, linear and compass gauges. |
| `markers` | Fixed reference values for arc, linear and compass gauges. |

### Linear gauges

```js
{
    id: 'fuel',
    type: 'linear',
    orientation: 'horizontal', // "horizontal" or "vertical"
    mode: 'fill-marker',       // "fill", "marker" or "fill-marker"
    label: 'FUEL',
    min: 0,
    max: 100,
    unit: '%'
}
```

### Compass gauges

```js
{
    id: 'heading',
    type: 'compass',
    label: 'HEADING',
    min: 0,
    max: 360
}
```

Compass bands may cross the wrap point:

```js
bands: [{ from: 330, to: 30, kind: 'warning', label: 'SECTOR' }]
```

### Status gauges

Status gauges use `states` to map incoming values to labels and semantic colors:

```js
{
    id: 'mode',
    type: 'status',
    label: 'MODE',
    states: [
        { value: 0, label: 'OFF', kind: 'inactive' },
        { value: 1, label: 'READY', kind: 'normal' },
        { value: 2, label: 'FAULT', kind: 'critical' }
    ]
}
```

Without an explicit `states` array, status gauges accept `false` as `OFF` and `true` as `ON`.

## Colors and themes

The panel accent colors live values and progress indicators. Bands, markers and states use their `kind`:

```js
import { MultiGauge, SEMANTIC_KINDS } from 'multi-gauge';

console.log(SEMANTIC_KINDS);
// ["normal", "warning", "critical", "inactive", "target"]

const panel = await MultiGauge.create(canvas, {
    accent: '#00eaff',
    theme: {
        background: '#071014',
        text: '#e7f7fa',
        normal: '#41e6a1',
        warning: '#ffc857',
        critical: '#ff4d6d',
        inactive: '#40515a',
        target: '#f3f7a7'
    },
    gauges: []
});
```

Additional theme keys can be used as custom `kind` values.

Use `setAccents()` when individual gauges need source-owned runtime colors:

```js
panel.setAccents({
    speed: '#4b9cff',
    temperature: '#ff8c42'
});
```

Per-gauge runtime accents are not included in serialized state.

## Grid and header

```js
const panel = await MultiGauge.create(canvas, {
    grid: { rows: 3, columns: 3, gap: 8 },
    header: {
        icon: new URL('./vehicle.svg', import.meta.url),
        title: 'VEHICLE 01',
        subtitle: 'Prototype telemetry',
        badge: 'ONLINE'
    },
    gauges: []
});
```

Header icons can be SVG, PNG or WebP URLs. Change the grid at runtime with:

```js
panel.setGrid({ rows: 4, columns: 4, gap: 8 });
```

## Updating values and configuration

```js
panel.set('speed', 130);
panel.update({ speed: 132, heading: 184 });
panel.setMarker('speed', 'target', 150);

panel.configure('speed', {
    type: 'linear',
    orientation: 'horizontal',
    mode: 'fill-marker'
});

panel.add({
    id: 'pressure',
    type: 'linear',
    label: 'PRESSURE',
    min: 0,
    max: 300,
    unit: 'bar'
});

panel.remove('pressure');
```

`set(id, value)` reports an unknown gauge. `update(values)` ignores unknown keys, which allows a telemetry source to continue publishing while gauges are added or removed.

## Editing and selection

Editing is enabled by default. Users can:

- Drag a gauge to move it.
- Drag from an edge or corner to resize it.
- Select a gauge with a click.
- Remove a gauge with its `×` control.
- Press `Escape` to cancel a move or resize.

```js
panel.setEditing(false);
panel.setEditing(true);

panel.move('speed', 0, 1);
panel.resize('speed', 2, 2);
panel.maximize('speed');
panel.restoreGauge('speed');
panel.minimize('speed');
panel.select('speed');
panel.select(null);
```

## Events

```js
panel.addEventListener('configurationchange', (event) => {
    const { reason, state } = event.detail;
    saveDashboard(state);
});

panel.addEventListener('selectionchange', (event) => {
    const { id, gauge } = event.detail;
    openGaugeEditor(id, gauge);
});
```

`configurationchange` is emitted after gauges are added, removed or configured and after grid or layout operations. Value updates, marker updates and runtime accents do not emit it. `selectionchange` is emitted when the selected gauge changes.

## Persistence

```js
const saved = JSON.stringify(panel.serialize());

// Later
panel.restore(JSON.parse(saved));
```

Serialized state contains the grid, header, theme, gauge configuration and current gauge values. Runtime accents and the current selection are not persisted.

## Fonts

MultiGauge uses the canvas' computed `font-family`. Define application fonts in CSS, or pass an explicit CSS font-family value:

```js
await document.fonts.ready;

const panel = await MultiGauge.create(canvas, {
    fontFamily: '"Inter Variable", Inter, sans-serif',
    gauges: []
});
```

MultiGauge does not include or download font files.

## API

| Method | Result |
| --- | --- |
| `MultiGauge.create(canvas, options)` | Creates a panel asynchronously. |
| `add(configuration)` | Adds and returns a gauge definition. |
| `remove(id)` | Removes a gauge and returns whether it existed. |
| `set(id, value)` | Updates one gauge. |
| `update(values)` | Updates several gauges. |
| `setMarker(gaugeId, markerId, value, options?)` | Adds or updates a marker. |
| `configure(id, patch)` | Updates a gauge definition. |
| `setAccents(accents)` | Applies transient per-gauge accent colors. |
| `setGrid(configuration)` | Changes grid rows, columns or gap. |
| `setEditing(enabled)` | Enables or disables direct editing. |
| `select(id)` | Selects a gauge, or clears selection with `null`. |
| `move(id, row, col)` | Moves a gauge. |
| `resize(id, rowSpan, colSpan)` | Resizes a gauge. |
| `maximize(id)` | Maximizes a gauge inside its grid. |
| `minimize(id)` | Minimizes a maximized gauge. |
| `restoreGauge(id)` | Restores the previous gauge placement. |
| `serialize()` | Returns JSON-compatible panel state. |
| `restore(state)` | Replaces the panel configuration. |
| `getStats()` | Returns diagnostic counters. |
| `destroy()` | Releases the panel and its browser resources. |

Call `destroy()` when the canvas is permanently removed:

```js
panel.destroy();
```

## Development

```sh
npm test
npm run demo
```

The demo is available at `http://localhost:8080/demo/` and the benchmark at `http://localhost:8080/benchmark/`.
