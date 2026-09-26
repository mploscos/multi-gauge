import test from 'node:test';
import assert from 'node:assert/strict';
import {
    addText,
    buildDynamicData,
    buildDynamicValues,
    buildStaticScene,
    dynamicTextKey,
    formatGaugeValue,
    TEXT_INSTANCE_SIZE
} from '../src/gpu/SceneBuilder.js';
import { TextAtlas } from '../src/gpu/TextAtlas.js';
import { layoutCell } from '../src/layout/CellLayout.js';
import { normalizeGauge } from '../src/model/GaugeModel.js';
import { color, resolveTheme } from '../src/theme.js';

function fakeAtlas(pixelRatio = 2, onGlyph) {
    const glyph = {
        width: 12,
        height: 20,
        bearingLeft: 3,
        bearingTop: 16,
        advance: 10,
        offsetX: 0,
        u0: 0,
        v0: 0,
        u1: 0.1,
        v1: 0.1
    };
    return {
        pixelRatio,
        style: () => ({ logicalSize: 10 }),
        glyph: (character) => {
            onGlyph?.(character);
            return glyph;
        },
        metrics: () => ({ ascent: 8, descent: 2, lineHeight: 10 }),
        measure: (value) => String(value).length * 5
    };
}

test('text quad edges snap to the physical pixel grid', () => {
    const output = [];
    addText(fakeAtlas(2), output, 'A', 10.13, 20.17, 10, [1, 1, 1, 1]);
    const [centerX, centerY, halfWidth, halfHeight] = output;
    for (const edge of [
        centerX - halfWidth,
        centerX + halfWidth,
        centerY - halfHeight,
        centerY + halfHeight
    ]) {
        assert.equal(edge * 2, Math.round(edge * 2));
    }
});

test('baseline positioning remains shared between value and unit roles', () => {
    const atlas = fakeAtlas(2);
    const value = [];
    const unit = [];
    addText(atlas, value, '9', 0, 30.13, 10, [1, 1, 1, 1], 'left', 'value', 'baseline');
    addText(atlas, unit, 'C', 8, 30.13, 10, [1, 1, 1, 1], 'left', 'regular', 'baseline');
    const valueTop = value[1] - value[3];
    const unitTop = unit[1] - unit[3];
    assert.equal(valueTop, unitTop);
});

test('text instances retain an explicit glyph rotation transform', () => {
    const output = [];
    addText(
        fakeAtlas(2),
        output,
        'A',
        20,
        30,
        10,
        [1, 1, 1, 1],
        'center',
        'label',
        'top',
        Math.PI / 2
    );
    assert.equal(output.length, TEXT_INSTANCE_SIZE);
    assert.ok(Math.abs(output[12]) < 1e-12);
    assert.equal(output[13], 1);
});

test('fixed styles and required HMI characters are present', () => {
    assert.deepEqual(TextAtlas.STYLES.map(({ id }) => id), [
        'uiSmall', 'uiMedium', 'unitSmall', 'unitMedium', 'unitLarge',
        'labelSmall', 'labelMedium',
        'valueSmall', 'valueMedium', 'valueLarge', 'header'
    ]);
    assert.deepEqual(
        TextAtlas.STYLES.filter(({ role }) => role === 'unit').map(({ logicalSize }) => logicalSize),
        [11, 12, 13]
    );
    for (const character of '°%/.-:µ·²³ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
        assert.ok(TextAtlas.CHARACTERS.includes(character), character);
    }
});

test('arc readouts stack the unit below the centered value', () => {
    const atlas = fakeAtlas(2);
    const gauge = normalizeGauge({ id: 'voltage', type: 'arc', value: 42, unit: 'V' });
    const layout = layoutCell({ width: 240, height: 200, gaugeType: 'arc', hasUnit: true });
    const data = buildDynamicData(
        atlas,
        [gauge],
        new Map([[gauge.id, layout]]),
        resolveTheme()
    );
    const valueY = data.text[1];
    const unitY = data.text[2 * TEXT_INSTANCE_SIZE + 1];
    assert.ok(unitY > valueY);
});

test('vertical linear readouts keep value and unit on the same baseline', () => {
    const atlas = fakeAtlas(2);
    const gauge = normalizeGauge({
        id: 'temperature',
        type: 'linear',
        orientation: 'vertical',
        value: 42,
        unit: 'C'
    });
    const layout = layoutCell({
        width: 180,
        height: 220,
        gaugeType: 'linear',
        orientation: 'vertical',
        hasUnit: true
    });
    const data = buildDynamicData(
        atlas,
        [gauge],
        new Map([[gauge.id, layout]]),
        resolveTheme()
    );
    const valueY = data.text[1];
    const unitY = data.text[2 * TEXT_INSTANCE_SIZE + 1];
    assert.ok(Math.abs(unitY - valueY) < 6);
});

test('only the value uses the active band color and returns to text outside bands', () => {
    const atlas = fakeAtlas(2);
    const theme = resolveTheme();
    const layout = layoutCell({ width: 240, height: 200, gaugeType: 'linear', hasUnit: true });
    const makeData = (value) => {
        const gauge = normalizeGauge({
            id: 'temperature',
            type: 'linear',
            value,
            unit: '°C',
            bands: [{ from: 70, to: 100, kind: 'critical' }]
        });
        return buildDynamicData(atlas, [gauge], new Map([[gauge.id, layout]]), theme);
    };
    const active = makeData(80);
    const normal = makeData(50);
    assert.deepEqual(active.values.slice(4, 8), color(theme.accent));
    assert.deepEqual(active.text.slice(8, 12), color(theme.critical));
    assert.deepEqual(normal.values.slice(4, 8), color(theme.accent));
    assert.deepEqual(normal.text.slice(8, 12), color(theme.text));
    const unitStart = String(80).length * TEXT_INSTANCE_SIZE;
    assert.deepEqual(active.text.slice(unitStart + 8, unitStart + 12),
        color(theme.text, layout.typography.unit.alpha));
});

test('dynamic text keys ignore visually equivalent samples but include band changes', () => {
    const gauge = normalizeGauge({
        id: 'temperature',
        type: 'linear',
        max: 50,
        value: 10.12,
        bands: [{ from: 20, to: 30, kind: 'warning' }]
    });
    const first = dynamicTextKey([gauge]);
    gauge.value = 10.13;
    assert.equal(dynamicTextKey([gauge]), first);
    gauge.value = 10.16;
    assert.notEqual(dynamicTextKey([gauge]), first);
    gauge.value = 20;
    assert.match(dynamicTextKey([gauge]), /@warning/);
});

test('numeric readouts keep a stable decimal width', () => {
    assert.equal(formatGaugeValue(normalizeGauge({ id: 'small', type: 'linear', min: 0, max: 20, value: 9 })), '9.0');
    assert.equal(formatGaugeValue(normalizeGauge({ id: 'small', type: 'linear', min: 0, max: 20, value: 9.1 })), '9.1');
    assert.equal(formatGaugeValue(normalizeGauge({ id: 'large', type: 'arc', min: 0, max: 200, value: 99.9 })), '100');
});

test('dynamic values can reuse a preallocated typed array', () => {
    const theme = resolveTheme();
    const gauge = normalizeGauge({ id: 'speed', type: 'arc', min: 0, max: 200, value: 50 });
    const output = new Float32Array(8);
    assert.equal(buildDynamicValues([gauge], theme, output), output);
    assert.equal(output[0], 0.25);
    gauge.value = 100;
    buildDynamicValues([gauge], theme, output);
    assert.equal(output[0], 0.5);
});

test('runtime gauge accents override the panel accent without changing the model', () => {
    const theme = resolveTheme({}, '#00eaff');
    const gauge = normalizeGauge({ id: 'speed', type: 'arc', value: 50 });
    const output = buildDynamicValues([gauge], theme, [], { speed: '#ff8800' });
    assert.deepEqual(output.slice(4, 8), color('#ff8800'));
    assert.equal(Object.hasOwn(gauge, 'accent'), false);
});

test('centered compass headings use three digits without a degree symbol', () => {
    const characters = [];
    const atlas = fakeAtlas(2, (character) => characters.push(character));
    const gauge = normalizeGauge({ id: 'heading', type: 'compass', value: 90, unit: 'deg' });
    const layout = layoutCell({ width: 240, height: 200, gaugeType: 'compass', hasUnit: true });
    buildDynamicData(
        atlas,
        [gauge],
        new Map([[gauge.id, layout]]),
        resolveTheme()
    );
    assert.deepEqual(characters, ['0', '9', '0']);
});

test('compass scene uses a perimeter marker and no center needle', () => {
    const atlas = fakeAtlas(2);
    const gauge = normalizeGauge({ id: 'heading', type: 'compass', value: 90 });
    const scene = buildStaticScene(
        atlas,
        [gauge],
        new Map([[gauge.id, { x: 0, y: 0, width: 240, height: 200 }]]),
        null,
        resolveTheme(),
        {
            headerRect: { x: 0, y: 0, width: 0, height: 0 },
            gridRect: { x: 0, y: 0, width: 240, height: 200 }
        }
    );
    const kinds = Array.from({ length: scene.shapes.length / 20 }, (_, index) =>
        scene.shapes[index * 20 + 8]);
    assert.ok(kinds.includes(6));
    assert.ok(!kinds.includes(4));
});

for (const type of ['arc', 'compass']) {
    test(`${type} key markers use a radial stroke across the ring`, () => {
        const atlas = fakeAtlas(2);
        const gauge = normalizeGauge({
            id: 'g',
            type,
            markers: [{ id: 'key', value: 50 }]
        });
        const scene = buildStaticScene(
            atlas,
            [gauge],
            new Map([['g', { x: 0, y: 0, width: 240, height: 200 }]]),
            null,
            resolveTheme(),
            {
                headerRect: { x: 0, y: 0, width: 0, height: 0 },
                gridRect: { x: 0, y: 0, width: 240, height: 200 }
            }
        );
        const marker = Array.from({ length: scene.shapes.length / 20 }, (_, index) => index)
            .find((index) => scene.shapes[index * 20 + 8] === 7
                && scene.shapes[index * 20 + 11] === 8);
        assert.notEqual(marker, undefined);
    });
}

test('radial degree ticks use crisp radial strokes with stronger major divisions', () => {
    const atlas = fakeAtlas(2);
    const theme = resolveTheme();
    const makeScene = (type) => buildStaticScene(
        atlas,
        [normalizeGauge({ id: 'g', type })],
        new Map([['g', { x: 0, y: 0, width: 360, height: 280 }]]),
        null,
        theme,
        {
            headerRect: { x: 0, y: 0, width: 0, height: 0 },
            gridRect: { x: 0, y: 0, width: 360, height: 280 }
        }
    );
    const arcScene = makeScene('arc');
    const arcTicks = Array.from({ length: arcScene.shapes.length / 20 }, (_, index) =>
        arcScene.shapes.slice(index * 20, index * 20 + 20))
        .filter((shape) => shape[8] === 7);
    const compassScene = makeScene('compass');
    const compassTicks = Array.from({ length: compassScene.shapes.length / 20 }, (_, index) =>
        compassScene.shapes.slice(index * 20, index * 20 + 20))
        .filter((shape) => shape[8] === 7);
    assert.equal(arcTicks.length, 11);
    assert.equal(compassTicks.length, 8);
    assert.equal(arcTicks.filter((shape) => shape[11] === 5).length, 3);
    assert.equal(arcTicks.filter((shape) => shape[11] === 3.5).length, 8);
    assert.deepEqual(arcTicks[0].slice(4, 8), color(theme.muted, 0.52));
    const track = Array.from({ length: arcScene.shapes.length / 20 }, (_, index) =>
        arcScene.shapes.slice(index * 20, index * 20 + 20))
        .find((shape) => shape[8] === 1);
    assert.ok(arcTicks.every((tick) => tick[10] + tick[11] <= track[12] - 11));
});

test('linear moving indicators use accent while key markers use target color', () => {
    const atlas = fakeAtlas(2);
    const theme = resolveTheme();
    const gauge = normalizeGauge({
        id: 'linear',
        type: 'linear',
        mode: 'marker',
        markers: [{ id: 'key', value: 50 }]
    });
    const scene = buildStaticScene(
        atlas,
        [gauge],
        new Map([['linear', { x: 0, y: 0, width: 300, height: 180 }]]),
        null,
        theme,
        {
            headerRect: { x: 0, y: 0, width: 0, height: 0 },
            gridRect: { x: 0, y: 0, width: 300, height: 180 }
        }
    );
    const shapes = Array.from({ length: scene.shapes.length / 20 }, (_, index) => {
        const base = index * 20;
        return {
            kind: scene.shapes[base + 8],
            rgba: scene.shapes.slice(base + 4, base + 8)
        };
    });
    const moving = shapes.find(({ kind }) => kind === 3);
    const key = shapes.find(({ kind, rgba }) => kind === 2
        && rgba.every((channel, index) => channel === color(theme.target)[index]));
    assert.deepEqual(moving.rgba, color(theme.accent));
    assert.ok(key);
    assert.notDeepEqual(moving.rgba, key.rgba);
});

test('linear gauges render scale ticks and configured marker labels', () => {
    const atlas = fakeAtlas(2);
    const gauge = normalizeGauge({
        id: 'linear',
        type: 'linear',
        orientation: 'vertical',
        label: '',
        markers: [{ id: 'key', value: 50, label: 'TARGET' }]
    });
    const scene = buildStaticScene(
        atlas,
        [gauge],
        new Map([['linear', { x: 0, y: 0, width: 300, height: 240 }]]),
        null,
        resolveTheme(),
        {
            headerRect: { x: 0, y: 0, width: 0, height: 0 },
            gridRect: { x: 0, y: 0, width: 300, height: 240 }
        }
    );
    const muted = color(resolveTheme().muted, 0.52);
    const shapes = Array.from({ length: scene.shapes.length / 20 }, (_, index) =>
        scene.shapes.slice(index * 20, index * 20 + 20));
    assert.equal(shapes.filter(shape => shape.slice(4, 8)
        .every((channel, index) => channel === muted[index])).length, 11);
    assert.equal(scene.text.length / TEXT_INSTANCE_SIZE, 'TARGET'.length);
});

test('vertical linear bands and labels share the right side of the track', () => {
    const atlas = fakeAtlas(2);
    const theme = resolveTheme();
    const gauge = normalizeGauge({
        id: 'linear', type: 'linear', orientation: 'vertical', label: '',
        bands: [{ from: 20, to: 60, kind: 'warning', label: 'B' }]
    });
    const scene = buildStaticScene(
        atlas,
        [gauge],
        new Map([['linear', { x: 0, y: 0, width: 300, height: 240 }]]),
        null,
        theme,
        {
            headerRect: { x: 0, y: 0, width: 0, height: 0 },
            gridRect: { x: 0, y: 0, width: 300, height: 240 }
        }
    );
    const warning = color(theme.warning);
    const band = Array.from({ length: scene.shapes.length / 20 }, (_, index) =>
        scene.shapes.slice(index * 20, index * 20 + 20))
        .find(shape => shape.slice(4, 8).every((channel, index) => channel === warning[index]));
    assert.ok(scene.text[0] > band[0]);
});

test('vertical linear readouts sit next to the track when no label lane is needed', () => {
    const atlas = fakeAtlas(2);
    const gauge = normalizeGauge({ id: 'linear', type: 'linear', orientation: 'vertical', label: '' });
    const scene = buildStaticScene(
        atlas,
        [gauge],
        new Map([['linear', { x: 0, y: 0, width: 180, height: 220 }]]),
        null,
        resolveTheme(),
        {
            headerRect: { x: 0, y: 0, width: 0, height: 0 },
            gridRect: { x: 0, y: 0, width: 180, height: 220 }
        }
    );
    const track = Array.from({ length: scene.shapes.length / 20 }, (_, index) =>
        scene.shapes.slice(index * 20, index * 20 + 20)).find(shape => shape[8] === 2);
    const trackRight = track[0] + track[2];
    assert.equal(scene.cellLayouts.get('linear').readoutRect.x - trackRight, 4);
});

for (const orientation of ['horizontal', 'vertical']) {
    test(`${orientation} linear fill and moving marker share the same value axis`, () => {
        const atlas = fakeAtlas(2);
        const gauge = normalizeGauge({
            id: 'linear',
            type: 'linear',
            orientation,
            mode: 'fill-marker'
        });
        const scene = buildStaticScene(
            atlas,
            [gauge],
            new Map([['linear', { x: 0, y: 0, width: 300, height: 180 }]]),
            null,
            resolveTheme(),
            {
                headerRect: { x: 0, y: 0, width: 0, height: 0 },
                gridRect: { x: 0, y: 0, width: 300, height: 180 }
            }
        );
        const shapes = Array.from({ length: scene.shapes.length / 20 }, (_, index) =>
            scene.shapes.slice(index * 20, index * 20 + 20));
        const fill = shapes.find((shape) => shape[8] === 2 && [2, 3].includes(shape[14]));
        const marker = shapes.find((shape) => shape[8] === 3);
        const centerAxis = orientation === 'vertical' ? 1 : 0;
        const extentAxis = orientation === 'vertical' ? 3 : 2;
        assert.equal(marker[centerAxis], fill[centerAxis]);
        assert.equal(marker[extentAxis], fill[extentAxis]);
    });
}

test('large arc scenes render configured band labels', () => {
    const atlas = fakeAtlas(2);
    const makeScene = (label) => buildStaticScene(
        atlas,
        [normalizeGauge({
            id: 'speed',
            type: 'arc',
            min: 0,
            max: 300,
            bands: [{ from: 120, to: 160, kind: 'normal', ...(label ? { label } : {}) }]
        })],
        new Map([['speed', { x: 0, y: 0, width: 360, height: 280 }]]),
        null,
        resolveTheme(),
        {
            headerRect: { x: 0, y: 0, width: 0, height: 0 },
            gridRect: { x: 0, y: 0, width: 360, height: 280 }
        }
    );
    const withoutLabel = makeScene();
    const withLabel = makeScene('NORMAL');
    assert.equal(
        (withLabel.text.length - withoutLabel.text.length) / TEXT_INSTANCE_SIZE,
        'NORMAL'.length
    );
});

test('radial band labels sit outside the arc and target labels use a separate outer tier', () => {
    const atlas = fakeAtlas(2);
    const gauge = normalizeGauge({
        id: 'g',
        label: 'G',
        type: 'arc',
        min: 0,
        max: 100,
        bands: [{ from: 40, to: 60, kind: 'normal', label: 'B' }],
        markers: [{ id: 'target', value: 50, label: 'T' }]
    });
    const scene = buildStaticScene(
        atlas,
        [gauge],
        new Map([['g', { x: 0, y: 0, width: 360, height: 280 }]]),
        null,
        resolveTheme(),
        {
            headerRect: { x: 0, y: 0, width: 0, height: 0 },
            gridRect: { x: 0, y: 0, width: 360, height: 280 }
        }
    );
    const bandShape = Array.from({ length: scene.shapes.length / 20 }, (_, index) => index)
        .find((index) => {
            const base = index * 20;
            return scene.shapes[base + 8] === 1
                && Math.abs(scene.shapes[base + 12] - scene.shapes[base + 11] - 2) < 0.001;
        });
    assert.notEqual(bandShape, undefined);
    const shapeBase = bandShape * 20;
    const centerY = scene.shapes[shapeBase + 1];
    const bandOuterRadius = scene.shapes[shapeBase + 12];
    const bandLabelY = scene.text[TEXT_INSTANCE_SIZE + 1];
    const targetLabelY = scene.text[TEXT_INSTANCE_SIZE * 2 + 1];
    assert.ok(centerY - bandLabelY > bandOuterRadius);
    assert.ok(bandLabelY - targetLabelY >= 15);
});

test('small radial gauges keep a useful radius and drop target labels instead of ellipsizing', () => {
    const atlas = fakeAtlas(2);
    const gauge = normalizeGauge({
        id: 'g',
        label: 'G',
        type: 'arc',
        markers: [{ id: 'target', value: 50, label: 'TARGET' }]
    });
    const scene = buildStaticScene(
        atlas,
        [gauge],
        new Map([['g', { x: 0, y: 0, width: 180, height: 140 }]]),
        null,
        resolveTheme(),
        {
            headerRect: { x: 0, y: 0, width: 0, height: 0 },
            gridRect: { x: 0, y: 0, width: 180, height: 140 }
        }
    );
    const baseArc = Array.from({ length: scene.shapes.length / 20 }, (_, index) => index)
        .find((index) => scene.shapes[index * 20 + 8] === 1);
    assert.notEqual(baseArc, undefined);
    assert.ok(scene.shapes[baseArc * 20 + 12] > 35);
    assert.equal(scene.text.length / TEXT_INSTANCE_SIZE, 1);
});

test('radial band label baselines rotate to the midpoint tangent', () => {
    const atlas = fakeAtlas(2);
    const gauge = normalizeGauge({
        id: 'g',
        label: 'G',
        type: 'arc',
        min: 0,
        max: 100,
        bands: [{ from: 70, to: 80, kind: 'warning', label: 'B' }]
    });
    const scene = buildStaticScene(
        atlas,
        [gauge],
        new Map([['g', { x: 0, y: 0, width: 300, height: 260 }]]),
        null,
        resolveTheme(),
        {
            headerRect: { x: 0, y: 0, width: 0, height: 0 },
            gridRect: { x: 0, y: 0, width: 300, height: 260 }
        }
    );
    const transform = TEXT_INSTANCE_SIZE + 12;
    const expected = 67.5 * Math.PI / 180;
    assert.ok(Math.abs(scene.text[transform] - Math.cos(expected)) < 1e-10);
    assert.ok(Math.abs(scene.text[transform + 1] - Math.sin(expected)) < 1e-10);
});

for (const configuration of [
    { name: 'horizontal linear', type: 'linear', orientation: 'horizontal', from: 20, to: 60 },
    { name: 'vertical linear', type: 'linear', orientation: 'vertical', from: 20, to: 60 },
    { name: 'compass', type: 'compass', from: 300, to: 40 }
]) {
    test(`${configuration.name} scenes render configured band labels`, () => {
        const atlas = fakeAtlas(2);
        const makeScene = (label) => buildStaticScene(
            atlas,
            [normalizeGauge({
                id: 'gauge',
                ...configuration,
                bands: [{
                    from: configuration.from,
                    to: configuration.to,
                    kind: 'warning',
                    ...(label ? { label } : {})
                }]
            })],
            new Map([['gauge', { x: 0, y: 0, width: 360, height: 280 }]]),
            null,
            resolveTheme(),
            {
                headerRect: { x: 0, y: 0, width: 0, height: 0 },
                gridRect: { x: 0, y: 0, width: 360, height: 280 }
            }
        );
        const withoutLabel = makeScene();
        const withLabel = makeScene('ZONE');
        assert.equal(
            (withLabel.text.length - withoutLabel.text.length) / TEXT_INSTANCE_SIZE,
            'ZONE'.length
        );
    });
}
