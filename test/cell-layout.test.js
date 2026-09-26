import test from 'node:test';
import assert from 'node:assert/strict';
import { fitText, layoutCell } from '../src/layout/CellLayout.js';

const measure = (text, size, font) => [...text].length * size * (font === 'value' ? 0.61 : 0.52);

test('fitText keeps case, prefers target size and shrinks using measured width', () => {
    const fitted = fitText('Main Battery Voltage', 112, {
        targetSize: 12,
        minSize: 9,
        measure
    });
    assert.equal(fitted.text, 'Main Battery Voltage');
    assert.ok(fitted.size < 12);
    assert.ok(fitted.width <= 112);
});

test('fitText truncates long labels with ellipsis only after reaching minimum size', () => {
    const fitted = fitText('HYDRAULIC SYSTEM PRESSURE', 90, {
        targetSize: 12,
        minSize: 9,
        measure
    });
    assert.equal(fitted.size, 9);
    assert.equal(fitted.truncated, true);
    assert.ok(fitted.text.endsWith('…'));
    assert.ok(fitted.width <= 90);
});

test('representative HMI labels always fit their assigned width', () => {
    const labels = [
        'SPEED',
        'ENGINE TEMPERATURE',
        'FRONT LEFT TYRE PRESSURE',
        'HYDRAULIC SYSTEM PRESSURE',
        'MAIN BATTERY VOLTAGE',
        'REAR RIGHT WHEEL TEMPERATURE'
    ];
    for (const label of labels) {
        const fitted = fitText(label, 118, { targetSize: 12, minSize: 9, measure });
        assert.ok(fitted.width <= 118, label);
    }
});

test('arc layout uses the full gauge region and centers its readout inside it', () => {
    for (const [width, height] of [[110, 110], [170, 150], [240, 200], [360, 280]]) {
        const layout = layoutCell({ width, height, hasInfo: true, hasUnit: true, gaugeType: 'arc' });
        assert.ok(layout.metaRect.y + layout.metaRect.height <= layout.gaugeRect.y);
        assert.ok(layout.readoutRect.y >= layout.gaugeRect.y);
        assert.ok(layout.readoutRect.y + layout.readoutRect.height
            <= layout.gaugeRect.y + layout.gaugeRect.height);
        assert.equal(layout.readoutMode, 'center-stacked');
    }
});

test('linear gauges retain a separate footer readout', () => {
    const layout = layoutCell({
        width: 240, height: 200, hasInfo: true, hasUnit: true, gaugeType: 'linear'
    });
    assert.ok(layout.gaugeRect.y + layout.gaugeRect.height <= layout.readoutRect.y);
    assert.ok(layout.readoutRect.y + layout.readoutRect.height <= 200);
    assert.equal(layout.readoutMode, 'footer-inline');
});

test('vertical linear gauges place an inline readout to the right of a full-height bar', () => {
    const layout = layoutCell({
        width: 180,
        height: 220,
        hasInfo: true,
        hasUnit: true,
        gaugeType: 'linear',
        orientation: 'vertical'
    });
    assert.equal(layout.readoutMode, 'side-inline');
    assert.ok(layout.gaugeRect.x + layout.gaugeRect.width <= layout.readoutRect.x);
    assert.ok(layout.readoutRect.y >= layout.gaugeRect.y);
    assert.ok(layout.readoutRect.y + layout.readoutRect.height
        <= layout.gaugeRect.y + layout.gaugeRect.height);
    assert.equal(layout.gaugeRect.y + layout.gaugeRect.height, 220 - layout.padding);
});

test('compass uses its full dial region and centers the heading readout', () => {
    const layout = layoutCell({ width: 240, height: 200, gaugeType: 'compass', hasUnit: true });
    assert.equal(layout.readoutMode, 'center-stacked');
    assert.equal(layout.showUnit, false);
    assert.ok(layout.readoutRect.y >= layout.gaugeRect.y);
    assert.ok(layout.readoutRect.y + layout.readoutRect.height
        <= layout.gaugeRect.y + layout.gaugeRect.height);
});

test('responsive priorities hide secondary detail before labels and values', () => {
    const small = layoutCell({
        width: 100, height: 100, hasInfo: true, hasUnit: true, hasMarkers: true, gaugeType: 'linear'
    });
    assert.equal(small.showInfo, false);
    assert.equal(small.showUnit, true);
    assert.equal(small.showTicks, false);
    assert.equal(small.typography.label.size, 10);
    assert.equal(small.typography.value.size, 17);
    assert.equal(small.typography.unit.size, 11);
    assert.equal(small.typography.unit.font, 'unit');

    const large = layoutCell({
        width: 360,
        height: 280,
        hasInfo: true,
        hasUnit: true,
        hasMarkers: true,
        hasMarkerLabels: true,
        hasBandLabels: true,
        gaugeType: 'arc'
    });
    assert.equal(large.showInfo, true);
    assert.equal(large.showBandLabels, true);
    assert.equal(large.showMarkerLabels, true);
    assert.equal(large.typography.label.size, 12);
    assert.equal(large.typography.unit.size, 13);
    assert.ok(large.typography.value.size <= 29);
});

test('radial label visibility follows configured content rather than size buckets', () => {
    const medium = layoutCell({
        width: 240,
        height: 200,
        gaugeType: 'arc',
        hasBandLabels: true,
        hasMarkerLabels: true
    });
    assert.equal(medium.level, 'medium');
    assert.equal(medium.showBandLabels, true);
    assert.equal(medium.showMarkerLabels, true);
});

test('typographic buckets are discrete and give added space to the gauge', () => {
    const small = layoutCell({ width: 150, height: 120, hasUnit: true });
    const medium = layoutCell({ width: 240, height: 190, hasInfo: true, hasUnit: true });
    const large = layoutCell({ width: 360, height: 280, hasInfo: true, hasUnit: true });
    assert.deepEqual([small.typography.value.size, medium.typography.value.size, large.typography.value.size],
        [17, 23, 29]);
    assert.ok(large.gaugeRect.height > medium.gaugeRect.height);
    assert.equal(large.typography.info.alpha, 0.70);
    assert.equal(large.typography.unit.alpha, 0.75);
    assert.equal(large.typography.ticks.alpha, 0.52);
});
