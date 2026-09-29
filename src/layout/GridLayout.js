import { MultiGaugeError } from '../errors.js';

function positiveInteger(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

function cloneEntries(entries) {
    return new Map([...entries].map(([id, item]) => [id, { ...item }]));
}

function overlaps(a, b) {
    return a.row < b.row + b.rowSpan
        && a.row + a.rowSpan > b.row
        && a.col < b.col + b.colSpan
        && a.col + a.colSpan > b.col;
}

function sortItems(entries) {
    return [...entries].sort(([idA, a], [idB, b]) => a.row - b.row
        || a.col - b.col
        || idA.localeCompare(idB));
}

function compareScores(a, b) {
    for (let index = 0; index < a.length; index += 1) {
        if (a[index] !== b[index]) {
            return a[index] - b[index];
        }
    }
    return 0;
}

/** A non-mutating drag/resize transaction over a committed GridLayout. */
export class GridDragSession {
    #layout;
    #id;
    #mode;
    #snapshot;
    #preview;
    #valid = true;
    #active = true;

    constructor(layout, id, mode = 'move') {
        if (mode !== 'move' && mode !== 'resize') {
            throw new MultiGaugeError(`Unknown grid transaction mode: ${mode}.`);
        }
        if (!layout.has(id)) {
            throw new MultiGaugeError(`Unknown gauge: ${id}.`);
        }
        this.#layout = layout;
        this.#id = id;
        this.#mode = mode;
        this.#snapshot = layout.snapshot();
        this.#preview = cloneEntries(this.#snapshot);
    }

    get entries() {
        return cloneEntries(this.#preview);
    }

    get placement() {
        return { ...this.#preview.get(this.#id) };
    }

    get valid() {
        return this.#valid;
    }

    preview(change) {
        if (!this.#active) {
            throw new MultiGaugeError('This grid transaction is no longer active.');
        }
        const current = this.#snapshot.get(this.#id);
        const candidate = this.#mode === 'resize'
            ? {
                ...current,
                row: Number.isInteger(change.row) ? change.row : current.row,
                col: Number.isInteger(change.col) ? change.col : current.col,
                rowSpan: positiveInteger(change.rowSpan, current.rowSpan),
                colSpan: positiveInteger(change.colSpan, current.colSpan)
            }
            : {
                ...current,
                row: change.row,
                col: change.col
            };
        const next = this.#mode === 'move' && change.fit
            ? this.#layout.previewMoveToFit(this.#id, candidate, {
                row: change.anchorRow,
                col: change.anchorCol
            }, this.#snapshot)
            : this.#layout.previewPlacement(this.#id, candidate, this.#snapshot);
        this.#valid = Boolean(next);
        this.#preview = next ?? cloneEntries(this.#snapshot);
        return {
            valid: this.#valid,
            entries: this.entries,
            placement: this.placement
        };
    }

    commit() {
        if (!this.#active) {
            return false;
        }
        this.#active = false;
        if (!this.#valid) {
            return false;
        }
        return this.#layout.commit(this.#preview);
    }

    cancel() {
        if (!this.#active) {
            return false;
        }
        this.#active = false;
        this.#preview = cloneEntries(this.#snapshot);
        return true;
    }
}

/** Grid placement and geometry, independent from DOM and WebGPU. */
export class GridLayout {
    #columns;
    #rows;
    #gap;
    #items = new Map();
    #saved = new Map();

    constructor({ rows = 1, columns = 1, gap = 8 } = {}) {
        this.#rows = positiveInteger(rows, 1);
        this.#columns = positiveInteger(columns, 1);
        this.#gap = Math.max(0, Number(gap) || 0);
    }

    get config() {
        return { rows: this.#rows, columns: this.#columns, gap: this.#gap };
    }

    get size() {
        return this.#items.size;
    }

    has(id) {
        return this.#items.has(id);
    }

    get(id) {
        const item = this.#items.get(id);
        return item ? { ...item } : undefined;
    }

    entries() {
        return [...this.#items.entries()].map(([id, item]) => [id, { ...item }]);
    }

    snapshot() {
        return cloneEntries(this.#items);
    }

    beginDrag(id, mode = 'move') {
        return new GridDragSession(this, id, mode);
    }

    add(id, requested = {}) {
        if (this.#items.has(id)) {
            throw new MultiGaugeError(`Gauge id already exists: ${id}.`);
        }
        const rowSpan = positiveInteger(requested.rowSpan, 1);
        const colSpan = positiveInteger(requested.colSpan, 1);
        const explicit = Number.isInteger(requested.row) && Number.isInteger(requested.col);
        const position = explicit
            ? { row: requested.row, col: requested.col, rowSpan, colSpan }
            : this.#find(rowSpan, colSpan, this.#items);
        if (!position || !this.#fits(position, this.#items)) {
            throw new MultiGaugeError(`Gauge "${id}" does not fit in the grid.`);
        }
        this.#items.set(id, position);
        return { ...position };
    }

    remove(id) {
        this.#saved.delete(id);
        return this.#items.delete(id);
    }

    move(id, row, col) {
        const session = this.beginDrag(id, 'move');
        const result = session.preview({ row, col });
        if (!result.valid || !session.commit()) {
            return false;
        }
        return this.get(id);
    }

    resize(id, rowSpan, colSpan) {
        const session = this.beginDrag(id, 'resize');
        const result = session.preview({ rowSpan, colSpan });
        if (!result.valid || !session.commit()) {
            return false;
        }
        return this.get(id);
    }

    /** Resolve a candidate from a stable snapshot without changing committed state. */
    previewPlacement(id, candidate, source = this.#items) {
        const initial = source.get(id);
        if (!initial || !this.#inBounds(candidate)) {
            return null;
        }
        const base = cloneEntries(source);
        const collisions = sortItems(new Map([...base].filter(([otherId, item]) => otherId !== id
            && !item.maximized && overlaps(candidate, item))));

        if (collisions.length === 0) {
            base.set(id, { ...candidate });
            return base;
        }

        if (collisions.length === 1) {
            const [otherId, other] = collisions[0];
            const exactFootprint = candidate.row === other.row && candidate.col === other.col
                && candidate.rowSpan === other.rowSpan && candidate.colSpan === other.colSpan
                && initial.rowSpan === other.rowSpan && initial.colSpan === other.colSpan;
            if (exactFootprint) {
                base.set(id, { ...candidate });
                base.set(otherId, { ...other, row: initial.row, col: initial.col });
                if (this.#valid(base)) {
                    return base;
                }
            }
        }

        const partial = cloneEntries(base);
        partial.delete(id);
        for (const [otherId] of collisions) {
            partial.delete(otherId);
        }
        partial.set(id, { ...candidate });
        const rowDirection = Math.sign(candidate.row - initial.row);
        const colDirection = Math.sign(candidate.col - initial.col);
        let resolved = true;
        for (const [otherId, item] of collisions) {
            const position = this.#nearestPosition(item, partial, {
                row: item.row + rowDirection * candidate.rowSpan,
                col: item.col + colDirection * candidate.colSpan
            });
            if (!position) {
                resolved = false;
                break;
            }
            partial.set(otherId, { ...item, ...position });
        }
        if (resolved && this.#valid(partial)) {
            return partial;
        }

        const compacted = new Map([[id, { ...candidate }]]);
        for (const [otherId, item] of sortItems(new Map([...base].filter(([otherId]) => otherId !== id)))) {
            const position = this.#find(item.rowSpan, item.colSpan, compacted);
            if (!position) {
                return null;
            }
            compacted.set(otherId, { ...item, ...position });
        }
        return this.#valid(compacted) ? compacted : null;
    }

    /**
     * Preview a move that may shrink into the largest free rectangle containing
     * the pointer cell. Occupied pointer cells retain the normal reflow/swap
     * semantics, so adaptive sizing never masks collision intent.
     */
    previewMoveToFit(id, candidate, anchor, source = this.#items) {
        const initial = source.get(id);
        if (!initial) {
            return null;
        }
        const row = Math.min(this.#rows - 1, Math.max(0, Math.round(candidate.row)));
        const col = Math.min(this.#columns - 1, Math.max(0, Math.round(candidate.col)));
        const window = {
            ...initial,
            row,
            col,
            rowSpan: Math.min(initial.rowSpan, this.#rows - row),
            colSpan: Math.min(initial.colSpan, this.#columns - col)
        };
        const anchorRow = Math.min(
            row + window.rowSpan - 1,
            Math.max(row, Math.round(anchor?.row ?? row))
        );
        const anchorCol = Math.min(
            col + window.colSpan - 1,
            Math.max(col, Math.round(anchor?.col ?? col))
        );
        const occupiedAnchor = [...source].some(([otherId, item]) => otherId !== id
            && !item.maximized
            && anchorRow >= item.row && anchorRow < item.row + item.rowSpan
            && anchorCol >= item.col && anchorCol < item.col + item.colSpan);
        if (occupiedAnchor) {
            const preserved = {
                ...initial,
                row: Math.min(this.#rows - initial.rowSpan, row),
                col: Math.min(this.#columns - initial.colSpan, col)
            };
            return this.previewPlacement(id, preserved, source);
        }

        const withoutMoving = new Map([...source].filter(([otherId]) => otherId !== id));
        let best = null;
        const requestedRatio = window.colSpan / window.rowSpan;
        for (let top = row; top <= anchorRow; top += 1) {
            for (let bottom = anchorRow + 1; bottom <= row + window.rowSpan; bottom += 1) {
                for (let left = col; left <= anchorCol; left += 1) {
                    for (let right = anchorCol + 1; right <= col + window.colSpan; right += 1) {
                        const placement = {
                            ...initial,
                            row: top,
                            col: left,
                            rowSpan: bottom - top,
                            colSpan: right - left
                        };
                        if (!this.#fits(placement, withoutMoving)) {
                            continue;
                        }
                        const score = [
                            -(placement.rowSpan * placement.colSpan),
                            Math.abs(placement.colSpan / placement.rowSpan - requestedRatio),
                            Math.abs(placement.row - row) + Math.abs(placement.col - col),
                            placement.row,
                            placement.col
                        ];
                        if (!best || compareScores(score, best.score) < 0) {
                            best = { placement, score };
                        }
                    }
                }
            }
        }
        if (!best) {
            return null;
        }
        const result = cloneEntries(source);
        result.set(id, best.placement);
        return result;
    }

    /** Atomically replace committed placements with a validated preview. */
    commit(entries) {
        if (!(entries instanceof Map) || entries.size !== this.#items.size
            || [...this.#items.keys()].some((id) => !entries.has(id))
            || !this.#valid(entries)) {
            return false;
        }
        this.#items = cloneEntries(entries);
        this.#saved.clear();
        return true;
    }

    maximize(id) {
        this.#remember(id);
        const current = this.#require(id);
        this.#items.set(id, { ...current, row: 0, col: 0, rowSpan: this.#rows, colSpan: this.#columns, maximized: true });
        return this.get(id);
    }

    minimize(id) {
        this.#remember(id);
        const current = this.#require(id);
        const position = this.#find(1, 1, this.#items, id);
        if (!position) {
            return false;
        }
        this.#items.set(id, { ...current, ...position, rowSpan: 1, colSpan: 1, minimized: true });
        return this.get(id);
    }

    restore(id) {
        const saved = this.#saved.get(id);
        if (!saved || !this.#fits(saved, this.#items, id)) {
            return false;
        }
        this.#items.set(id, saved);
        this.#saved.delete(id);
        return this.get(id);
    }

    occupancy(ignoreId, entries = this.#items) {
        const cells = Array.from({ length: this.#rows }, () => Array(this.#columns).fill(null));
        for (const [id, item] of entries) {
            if (id === ignoreId || item.maximized) {
                continue;
            }
            for (let row = item.row; row < item.row + item.rowSpan; row += 1) {
                for (let col = item.col; col < item.col + item.colSpan; col += 1) {
                    if (cells[row]) {
                        cells[row][col] = id;
                    }
                }
            }
        }
        return cells;
    }

    rectangles(gridRect, entries = this.#items) {
        const width = Math.max(0, Number(gridRect?.width) || 0);
        const height = Math.max(0, Number(gridRect?.height) || 0);
        const originX = Number(gridRect?.x) || 0;
        const originY = Number(gridRect?.y) || 0;
        const cellWidth = Math.max(0, (width - this.#gap * (this.#columns - 1)) / this.#columns);
        const cellHeight = Math.max(0, (height - this.#gap * (this.#rows - 1)) / this.#rows);
        const result = new Map();
        for (const [id, item] of entries) {
            result.set(id, {
                x: originX + item.col * (cellWidth + this.#gap),
                y: originY + item.row * (cellHeight + this.#gap),
                width: item.colSpan * cellWidth + (item.colSpan - 1) * this.#gap,
                height: item.rowSpan * cellHeight + (item.rowSpan - 1) * this.#gap
            });
        }
        return result;
    }

    #require(id) {
        const item = this.#items.get(id);
        if (!item) {
            throw new MultiGaugeError(`Unknown gauge: ${id}.`);
        }
        return item;
    }

    #remember(id) {
        if (!this.#saved.has(id)) {
            const current = this.#require(id);
            const { maximized, minimized, ...plain } = current;
            this.#saved.set(id, plain);
        }
    }

    #find(rowSpan, colSpan, entries, ignoreId) {
        for (let row = 0; row <= this.#rows - rowSpan; row += 1) {
            for (let col = 0; col <= this.#columns - colSpan; col += 1) {
                const candidate = { row, col, rowSpan, colSpan };
                if (this.#fits(candidate, entries, ignoreId)) {
                    return candidate;
                }
            }
        }
        return null;
    }

    #nearestPosition(item, entries, anchor) {
        const candidates = [];
        for (let row = 0; row <= this.#rows - item.rowSpan; row += 1) {
            for (let col = 0; col <= this.#columns - item.colSpan; col += 1) {
                const candidate = { row, col, rowSpan: item.rowSpan, colSpan: item.colSpan };
                if (this.#fits(candidate, entries)) {
                    candidates.push(candidate);
                }
            }
        }
        candidates.sort((a, b) => (Math.abs(a.row - anchor.row) + Math.abs(a.col - anchor.col))
            - (Math.abs(b.row - anchor.row) + Math.abs(b.col - anchor.col))
            || a.row - b.row || a.col - b.col);
        return candidates[0] ?? null;
    }

    #inBounds(item) {
        return Number.isInteger(item.row) && Number.isInteger(item.col)
            && positiveInteger(item.rowSpan, 0) === item.rowSpan
            && positiveInteger(item.colSpan, 0) === item.colSpan
            && item.row >= 0 && item.col >= 0
            && item.row + item.rowSpan <= this.#rows
            && item.col + item.colSpan <= this.#columns;
    }

    #fits(item, entries, ignoreId) {
        return this.#inBounds(item) && ![...entries].some(([id, placed]) => id !== ignoreId
            && !placed.maximized && overlaps(item, placed));
    }

    #valid(entries) {
        const items = [...entries];
        for (let index = 0; index < items.length; index += 1) {
            const [, item] = items[index];
            if (!this.#inBounds(item)) {
                return false;
            }
            for (let other = index + 1; other < items.length; other += 1) {
                if (!item.maximized && !items[other][1].maximized && overlaps(item, items[other][1])) {
                    return false;
                }
            }
        }
        return true;
    }
}
