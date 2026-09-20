import test from 'node:test';
import assert from 'node:assert/strict';
import { GridLayout } from '../src/layout/GridLayout.js';

function placements(grid) {
    return Object.fromEntries(grid.entries());
}

function assertNoOverlap(grid) {
    const occupied = grid.occupancy().flat().filter(Boolean);
    const expected = grid.entries().reduce((total, [, item]) => total + item.rowSpan * item.colSpan, 0);
    assert.equal(occupied.length, expected);
}

test('auto-placement honors occupancy and spans', () => {
    const grid = new GridLayout({ rows: 2, columns: 3, gap: 8 });
    assert.deepEqual(grid.add('wide', { colSpan: 2 }), { row: 0, col: 0, rowSpan: 1, colSpan: 2 });
    assert.deepEqual(grid.add('small'), { row: 0, col: 2, rowSpan: 1, colSpan: 1 });
    assert.deepEqual(grid.add('bottom', { colSpan: 3 }), { row: 1, col: 0, rowSpan: 1, colSpan: 3 });
    assert.deepEqual(grid.occupancy(), [['wide', 'wide', 'small'], ['bottom', 'bottom', 'bottom']]);
});

test('1x1 items swap exact footprints without mutating the preview source', () => {
    const grid = new GridLayout({ rows: 1, columns: 2 });
    grid.add('a', { row: 0, col: 0 });
    grid.add('b', { row: 0, col: 1 });
    const drag = grid.beginDrag('a');
    const preview = drag.preview({ row: 0, col: 1 });
    assert.equal(preview.valid, true);
    assert.deepEqual(grid.get('a'), { row: 0, col: 0, rowSpan: 1, colSpan: 1 });
    assert.equal(preview.entries.get('b').col, 0);
    assert.equal(drag.commit(), true);
    assert.equal(grid.get('a').col, 1);
    assert.equal(grid.get('b').col, 0);
});

test('2x1 items swap exact footprints', () => {
    const grid = new GridLayout({ rows: 1, columns: 4 });
    grid.add('a', { row: 0, col: 0, colSpan: 2 });
    grid.add('b', { row: 0, col: 2, colSpan: 2 });
    assert.ok(grid.move('a', 0, 2));
    assert.equal(grid.get('b').col, 0);
    assertNoOverlap(grid);
});

test('a 2x2 item moves into a free footprint', () => {
    const grid = new GridLayout({ rows: 3, columns: 4 });
    grid.add('large', { row: 0, col: 0, rowSpan: 2, colSpan: 2 });
    assert.ok(grid.move('large', 1, 2));
    assert.deepEqual(grid.get('large'), { row: 1, col: 2, rowSpan: 2, colSpan: 2 });
});

test('collision with several 1x1 items reflows only as needed', () => {
    const grid = new GridLayout({ rows: 3, columns: 3 });
    grid.add('large', { row: 0, col: 0, rowSpan: 2, colSpan: 2 });
    grid.add('b', { row: 0, col: 2 });
    grid.add('c', { row: 1, col: 2 });
    grid.add('d', { row: 2, col: 2 });
    assert.ok(grid.move('large', 0, 1));
    assert.deepEqual(grid.get('large'), { row: 0, col: 1, rowSpan: 2, colSpan: 2 });
    assertNoOverlap(grid);
});

test('resize can grow with deterministic reflow and shrink in place', () => {
    const grid = new GridLayout({ rows: 3, columns: 3 });
    grid.add('a', { row: 0, col: 0 });
    grid.add('b', { row: 0, col: 1 });
    grid.add('c', { row: 1, col: 0 });
    assert.ok(grid.resize('a', 2, 2));
    assert.deepEqual(grid.get('a'), { row: 0, col: 0, rowSpan: 2, colSpan: 2 });
    assertNoOverlap(grid);
    assert.ok(grid.resize('a', 1, 1));
    assert.deepEqual(grid.get('a'), { row: 0, col: 0, rowSpan: 1, colSpan: 1 });
});

test('resize transactions can move the top-left corner while preserving the opposite edge', () => {
    const grid = new GridLayout({ rows: 4, columns: 4 });
    grid.add('a', { row: 2, col: 2, rowSpan: 2, colSpan: 2 });
    const drag = grid.beginDrag('a', 'resize');
    const preview = drag.preview({ row: 1, col: 0, rowSpan: 3, colSpan: 4 });
    assert.equal(preview.valid, true);
    assert.deepEqual(preview.placement, { row: 1, col: 0, rowSpan: 3, colSpan: 4 });
    assert.equal(drag.commit(), true);
    assert.deepEqual(grid.get('a'), { row: 1, col: 0, rowSpan: 3, colSpan: 4 });
});

test('out-of-bounds and impossible previews leave committed layout unchanged', () => {
    const grid = new GridLayout({ rows: 2, columns: 2 });
    for (const [id, row, col] of [['a', 0, 0], ['b', 0, 1], ['c', 1, 0], ['d', 1, 1]]) {
        grid.add(id, { row, col });
    }
    const before = placements(grid);
    assert.equal(grid.move('a', -1, 0), false);
    assert.equal(grid.resize('a', 1, 2), false);
    assert.deepEqual(placements(grid), before);
});

test('cancel discards a valid preview exactly', () => {
    const grid = new GridLayout({ rows: 2, columns: 2 });
    grid.add('a', { row: 0, col: 0 });
    grid.add('b', { row: 0, col: 1 });
    const before = placements(grid);
    const drag = grid.beginDrag('a');
    assert.equal(drag.preview({ row: 0, col: 1 }).valid, true);
    assert.equal(drag.cancel(), true);
    assert.deepEqual(placements(grid), before);
});

test('the same collision always produces the same no-overlap result', () => {
    function run() {
        const grid = new GridLayout({ rows: 3, columns: 3 });
        grid.add('large', { row: 0, col: 0, rowSpan: 2, colSpan: 2 });
        grid.add('b', { row: 0, col: 2 });
        grid.add('c', { row: 1, col: 2 });
        grid.add('d', { row: 2, col: 0 });
        grid.add('e', { row: 2, col: 1 });
        assert.ok(grid.move('large', 1, 1));
        assertNoOverlap(grid);
        return placements(grid);
    }
    assert.deepEqual(run(), run());
});

test('maximize, minimize and pixel rectangles remain stable', () => {
    const grid = new GridLayout({ rows: 3, columns: 3, gap: 10 });
    grid.add('a', { row: 1, col: 1, rowSpan: 2, colSpan: 2 });
    assert.equal(grid.maximize('a').rowSpan, 3);
    assert.deepEqual(grid.restore('a'), { row: 1, col: 1, rowSpan: 2, colSpan: 2 });
    grid.minimize('a');
    assert.equal(grid.get('a').rowSpan, 1);
    assert.deepEqual(grid.restore('a'), { row: 1, col: 1, rowSpan: 2, colSpan: 2 });
    assert.deepEqual(grid.rectangles({ x: 0, y: 20, width: 320, height: 320 }).get('a'),
        { x: 110, y: 130, width: 210, height: 210 });
});

test('first and last cells use only the supplied grid rect', () => {
    const grid = new GridLayout({ rows: 2, columns: 2, gap: 8 });
    grid.add('first', { row: 0, col: 0 });
    grid.add('last', { row: 1, col: 1 });
    const bounds = { x: 7, y: 72, width: 408, height: 308 };
    const rectangles = grid.rectangles(bounds);
    assert.deepEqual(rectangles.get('first'), { x: 7, y: 72, width: 200, height: 150 });
    assert.deepEqual(rectangles.get('last'), { x: 215, y: 230, width: 200, height: 150 });
});

test('dragging last into first and resizing first remain deterministic', () => {
    const grid = new GridLayout({ rows: 2, columns: 3 });
    for (const [id, row, col] of [['first', 0, 0], ['middle', 0, 1], ['last', 1, 2]]) {
        grid.add(id, { row, col });
    }
    assert.ok(grid.move('last', 0, 0));
    assert.deepEqual(grid.get('last'), { row: 0, col: 0, rowSpan: 1, colSpan: 1 });
    assertNoOverlap(grid);
    assert.ok(grid.resize('last', 2, 1));
    assert.equal(grid.get('last').rowSpan, 2);
    assertNoOverlap(grid);
});
