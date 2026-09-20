import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutPanel, localRect } from '../src/layout/PanelLayout.js';
import { GridLayout } from '../src/layout/GridLayout.js';

test('a panel without header gives the entire content box to the grid', () => {
    const layout = layoutPanel({ width: 640, height: 360 });
    assert.deepEqual(layout.headerRect, { x: 0, y: 0, width: 640, height: 0 });
    assert.deepEqual(layout.gridRect, { x: 0, y: 0, width: 640, height: 360 });
});

test('compact and regular headers produce one disjoint grid rect', () => {
    const compact = layoutPanel({ width: 280, height: 300, hasHeader: true });
    const regular = layoutPanel({ width: 800, height: 500, hasHeader: true });
    assert.equal(compact.headerRect.height, 52);
    assert.equal(compact.gridRect.y, 60);
    assert.equal(regular.headerRect.height, 64);
    assert.equal(regular.gridRect.y, 72);
    for (const layout of [compact, regular]) {
        assert.ok(layout.headerRect.y + layout.headerRect.height <= layout.gridRect.y);
        assert.equal(layout.gridRect.y + layout.gridRect.height, layout.panelRect.height);
    }
});

test('resizing recomputes cells inside gridRect and never inside the header', () => {
    const grid = new GridLayout({ rows: 2, columns: 2, gap: 8 });
    grid.add('first', { row: 0, col: 0 });
    grid.add('last', { row: 1, col: 1 });
    for (const [width, height] of [[280, 300], [640, 420], [920, 560]]) {
        const panel = layoutPanel({ width, height, hasHeader: true });
        for (const rect of grid.rectangles(panel.gridRect).values()) {
            assert.ok(rect.y >= panel.gridRect.y);
            assert.ok(rect.y >= panel.headerRect.y + panel.headerRect.height);
            const local = localRect(rect, panel.gridRect);
            assert.ok(local.x >= 0 && local.y >= 0);
            assert.ok(local.x + local.width <= panel.gridRect.width);
            assert.ok(local.y + local.height <= panel.gridRect.height);
        }
    }
});
