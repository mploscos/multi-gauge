import { localRect } from '../layout/PanelLayout.js';

const HYSTERESIS = 0.62;
const EDGE_HIT_SIZE = 18;

function setRect(element, rect) {
    element.style.left = `${rect.x}px`;
    element.style.top = `${rect.y}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
}

/** Transactional DOM interaction layer. GridLayout remains the source of truth. */
export class GridEditor {
    #canvas;
    #overlay;
    #placeholder;
    #layout;
    #actions;
    #nodes = new Map();
    #rectangles = new Map();
    #drag;
    #frame;
    #parentPosition;
    #panelLayout;
    #selectedId = null;

    constructor(canvas, layout, actions) {
        this.#canvas = canvas;
        this.#layout = layout;
        this.#actions = actions;
        const parent = canvas.parentElement;
        if (!parent) {
            throw new Error('Grid editing requires the canvas to have a parent element.');
        }
        this.#parentPosition = parent.style.position;
        if (getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
        }
        this.#overlay = document.createElement('div');
        this.#overlay.dataset.multigaugeEditor = '';
        Object.assign(this.#overlay.style, {
            position: 'absolute',
            zIndex: '10',
            overflow: 'hidden',
            touchAction: 'none'
        });
        this.#placeholder = document.createElement('div');
        this.#placeholder.dataset.gridPlaceholder = '';
        Object.assign(this.#placeholder.style, {
            position: 'absolute',
            display: 'none',
            boxSizing: 'border-box',
            border: '1px solid #00eaff',
            borderRadius: '7px',
            background: 'rgba(0, 234, 255, 0.10)',
            pointerEvents: 'none',
            transition: 'transform 90ms ease, width 90ms ease, height 90ms ease'
        });
        this.#overlay.append(this.#placeholder);
        parent.append(this.#overlay);
        this.#overlay.addEventListener('pointerdown', this.#onPointerDown);
        this.#overlay.addEventListener('pointermove', this.#onPointerMove);
        this.#overlay.addEventListener('pointerup', this.#onPointerUp);
        this.#overlay.addEventListener('pointercancel', this.#onPointerCancel);
        this.#overlay.addEventListener('click', this.#onClick);
        window.addEventListener('keydown', this.#onKeyDown);
    }

    /** Synchronize committed geometry without rebuilding existing DOM nodes. */
    refresh(rectangles, panelLayout) {
        this.#panelLayout = panelLayout;
        const gridRect = panelLayout.gridRect;
        this.#rectangles = new Map([...rectangles]
            .map(([id, rect]) => [id, localRect(rect, gridRect)]));
        const style = getComputedStyle(this.#canvas);
        const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
        const paddingTop = Number.parseFloat(style.paddingTop) || 0;
        Object.assign(this.#overlay.style, {
            left: `${this.#canvas.offsetLeft + this.#canvas.clientLeft + paddingLeft + gridRect.x}px`,
            top: `${this.#canvas.offsetTop + this.#canvas.clientTop + paddingTop + gridRect.y}px`,
            width: `${gridRect.width}px`,
            height: `${gridRect.height}px`
        });
        for (const [id, node] of this.#nodes) {
            if (!rectangles.has(id)) {
                node.remove();
                this.#nodes.delete(id);
            }
        }
        for (const [id, rect] of this.#rectangles) {
            let item = this.#nodes.get(id);
            if (!item) {
                item = this.#createItem(id);
                this.#nodes.set(id, item);
                this.#overlay.append(item);
            }
            setRect(item, rect);
            if (!this.#drag) {
                item.style.transform = 'translate3d(0, 0, 0)';
            }
            item.style.borderColor = this.#drag?.id === id || this.#selectedId === id
                ? '#00eaff'
                : 'transparent';
        }
    }

    /** Highlight one gauge without changing the layout. */
    select(id) {
        this.#selectedId = id ?? null;
        for (const [gaugeId, item] of this.#nodes) {
            item.style.borderColor = gaugeId === this.#selectedId ? '#00eaff' : 'transparent';
        }
    }

    destroy() {
        const parent = this.#canvas.parentElement;
        this.#cancelDrag();
        this.#overlay.removeEventListener('pointerdown', this.#onPointerDown);
        this.#overlay.removeEventListener('pointermove', this.#onPointerMove);
        this.#overlay.removeEventListener('pointerup', this.#onPointerUp);
        this.#overlay.removeEventListener('pointercancel', this.#onPointerCancel);
        this.#overlay.removeEventListener('click', this.#onClick);
        window.removeEventListener('keydown', this.#onKeyDown);
        this.#overlay.remove();
        if (parent) {
            parent.style.position = this.#parentPosition;
        }
    }

    #createItem(id) {
        const item = document.createElement('div');
        item.dataset.gaugeId = id;
        Object.assign(item.style, {
            position: 'absolute',
            boxSizing: 'border-box',
            border: '1px solid transparent',
            borderRadius: '7px',
            cursor: 'grab',
            background: 'transparent',
            willChange: 'transform',
            contain: 'layout style paint'
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.dataset.gaugeRemove = '';
        remove.title = `Remove ${id}`;
        remove.setAttribute('aria-label', remove.title);
        remove.textContent = '×';
        Object.assign(remove.style, {
            position: 'absolute',
            top: '4px',
            right: '4px',
            zIndex: '2',
            width: '24px',
            height: '24px',
            padding: '0',
            border: '0',
            borderRadius: '0',
            color: 'rgba(220, 239, 243, 0.72)',
            background: 'transparent',
            appearance: 'none',
            font: 'inherit',
            fontSize: '20px',
            fontWeight: '400',
            lineHeight: '1',
            textShadow: '0 1px 2px rgba(0, 0, 0, 0.9)',
            cursor: 'pointer'
        });
        item.append(remove);
        return item;
    }

    #onPointerDown = (event) => {
        if (this.#drag || event.button !== 0 || event.target.closest?.('[data-gauge-remove]')) {
            return;
        }
        const item = event.target.closest('[data-gauge-id]');
        if (!item) {
            return;
        }
        const id = item.dataset.gaugeId;
        const resizeEdges = this.#resizeEdges(item, event);
        const resize = Boolean(resizeEdges);
        const initial = this.#layout.get(id);
        const rect = this.#rectangles.get(id);
        if (!initial || !rect) {
            return;
        }
        const point = this.#pointerLocal(event);
        this.#drag = {
            id,
            item,
            pointerId: event.pointerId,
            startX: point.x,
            startY: point.y,
            x: point.x,
            y: point.y,
            dx: 0,
            dy: 0,
            initial,
            initialRect: { ...rect },
            gridRow: initial.row,
            gridCol: initial.col,
            rowSpan: initial.rowSpan,
            colSpan: initial.colSpan,
            resize,
            resizeX: resizeEdges?.x ?? 0,
            resizeY: resizeEdges?.y ?? 0,
            valid: true,
            previewed: false,
            session: this.#layout.beginDrag(id, resize ? 'resize' : 'move')
        };
        item.setPointerCapture(event.pointerId);
        item.style.cursor = resize ? this.#resizeCursor(resizeEdges) : 'grabbing';
        item.style.zIndex = '3';
        item.style.borderStyle = 'solid';
        item.style.borderColor = '#00eaff';
        item.style.background = 'rgba(0, 234, 255, 0.08)';
        this.#placeholder.style.display = 'block';
        setRect(this.#placeholder, rect);
        event.preventDefault();
    };

    #onClick = (event) => {
        const button = event.target.closest?.('[data-gauge-remove]');
        const id = button?.closest?.('[data-gauge-id]')?.dataset.gaugeId;
        if (!id) return;
        event.preventDefault();
        event.stopPropagation();
        this.#actions.remove?.(id);
    };

    #onPointerMove = (event) => {
        if (!this.#drag) {
            const item = event.target.closest?.('[data-gauge-id]');
            if (item) {
                item.style.cursor = this.#resizeCursor(this.#resizeEdges(item, event));
            }
            return;
        }
        if (event.pointerId !== this.#drag.pointerId) {
            return;
        }
        const point = this.#pointerLocal(event);
        this.#drag.x = point.x;
        this.#drag.y = point.y;
        this.#drag.dx = point.x - this.#drag.startX;
        this.#drag.dy = point.y - this.#drag.startY;
        if (this.#frame === undefined) {
            this.#frame = requestAnimationFrame(this.#applyPointerTransform);
        }
        this.#updateGridPreview();
        event.preventDefault();
    };

    #applyPointerTransform = () => {
        this.#frame = undefined;
        if (!this.#drag) {
            return;
        }
        if (this.#drag.resize) {
            const minWidth = Math.min(24, this.#drag.initialRect.width);
            const minHeight = Math.min(24, this.#drag.initialRect.height);
            const widthDelta = this.#drag.dx * this.#drag.resizeX;
            const heightDelta = this.#drag.dy * this.#drag.resizeY;
            const width = Math.max(minWidth, this.#drag.initialRect.width + widthDelta);
            const height = Math.max(minHeight, this.#drag.initialRect.height + heightDelta);
            const offsetX = this.#drag.resizeX < 0
                ? this.#drag.initialRect.width - width
                : 0;
            const offsetY = this.#drag.resizeY < 0
                ? this.#drag.initialRect.height - height
                : 0;
            this.#drag.item.style.width = `${width}px`;
            this.#drag.item.style.height = `${height}px`;
            this.#drag.item.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0)`;
        } else {
            this.#drag.item.style.transform = `translate3d(${this.#drag.dx}px, ${this.#drag.dy}px, 0)`;
        }
    };

    #updateGridPreview() {
        const drag = this.#drag;
        const { rows, columns, gap } = this.#layout.config;
        const gridRect = this.#panelLayout.gridRect;
        const cellWidth = (gridRect.width - gap * (columns - 1)) / columns;
        const cellHeight = (gridRect.height - gap * (rows - 1)) / rows;
        const columnPitch = cellWidth + gap;
        const rowPitch = cellHeight + gap;
        let nextRow = drag.gridRow;
        let nextCol = drag.gridCol;
        let nextRowSpan = drag.rowSpan;
        let nextColSpan = drag.colSpan;

        if (drag.resize) {
            if (drag.resizeX < 0) {
                nextCol = this.#quantize(drag.initial.col + drag.dx / columnPitch,
                    drag.gridCol, 0, drag.initial.col + drag.initial.colSpan - 1);
                nextColSpan = drag.initial.colSpan + drag.initial.col - nextCol;
            } else if (drag.resizeX > 0) {
                nextColSpan = this.#quantize(drag.initial.colSpan + drag.dx / columnPitch,
                    drag.colSpan, 1, columns - drag.initial.col);
            }
            if (drag.resizeY < 0) {
                nextRow = this.#quantize(drag.initial.row + drag.dy / rowPitch,
                    drag.gridRow, 0, drag.initial.row + drag.initial.rowSpan - 1);
                nextRowSpan = drag.initial.rowSpan + drag.initial.row - nextRow;
            } else if (drag.resizeY > 0) {
                nextRowSpan = this.#quantize(drag.initial.rowSpan + drag.dy / rowPitch,
                    drag.rowSpan, 1, rows - drag.initial.row);
            }
        } else {
            nextCol = this.#quantize(drag.initial.col + drag.dx / columnPitch,
                drag.gridCol, 0, columns - drag.initial.colSpan);
            nextRow = this.#quantize(drag.initial.row + drag.dy / rowPitch,
                drag.gridRow, 0, rows - drag.initial.rowSpan);
        }
        if (nextRow === drag.gridRow && nextCol === drag.gridCol
            && nextRowSpan === drag.rowSpan && nextColSpan === drag.colSpan) {
            return;
        }
        drag.gridRow = nextRow;
        drag.gridCol = nextCol;
        drag.rowSpan = nextRowSpan;
        drag.colSpan = nextColSpan;
        drag.previewed = true;
        const preview = drag.resize
            ? drag.session.preview({
                row: nextRow,
                col: nextCol,
                rowSpan: nextRowSpan,
                colSpan: nextColSpan
            })
            : drag.session.preview({ row: nextRow, col: nextCol });
        drag.valid = preview.valid;
        this.#showPreview(preview.entries, preview.valid, {
            ...drag.initial,
            row: nextRow,
            col: nextCol,
            rowSpan: nextRowSpan,
            colSpan: nextColSpan
        });
        this.#actions.preview(preview.entries);
    }

    #showPreview(entries, valid, candidate) {
        const gridRect = this.#panelLayout.gridRect;
        const previewRects = new Map([...this.#layout.rectangles(gridRect, entries)]
            .map(([id, rect]) => [id, localRect(rect, gridRect)]));
        for (const [id, node] of this.#nodes) {
            if (id === this.#drag.id) {
                continue;
            }
            const committed = this.#rectangles.get(id);
            const preview = previewRects.get(id);
            if (committed && preview) {
                node.style.transform = `translate3d(${preview.x - committed.x}px, ${preview.y - committed.y}px, 0)`;
            }
        }
        const placeholderRect = valid
            ? previewRects.get(this.#drag.id)
            : localRect(this.#layout.rectangles(
                gridRect,
                new Map([[this.#drag.id, candidate]])
            ).get(this.#drag.id), gridRect);
        setRect(this.#placeholder, placeholderRect);
        this.#placeholder.style.borderColor = valid ? '#00eaff' : '#ff4d6d';
        this.#placeholder.style.background = valid
            ? 'rgba(0, 234, 255, 0.10)'
            : 'rgba(255, 77, 109, 0.10)';
    }

    #onPointerUp = (event) => {
        if (!this.#drag || event.pointerId !== this.#drag.pointerId) {
            return;
        }
        if (!this.#drag.previewed) {
            const id = this.#drag.id;
            this.#drag.session.cancel();
            this.#finishDrag(null);
            this.#actions.select?.(id);
            event.preventDefault();
            return;
        }
        const committed = this.#drag.valid && this.#drag.session.commit();
        if (!committed) {
            this.#drag.session.cancel();
        }
        this.#finishDrag(committed);
        event.preventDefault();
    };

    #onPointerCancel = (event) => {
        if (this.#drag && event.pointerId === this.#drag.pointerId) {
            this.#cancelDrag();
        }
    };

    #onKeyDown = (event) => {
        if (event.key === 'Escape' && this.#drag) {
            event.preventDefault();
            this.#cancelDrag();
        }
    };

    #cancelDrag() {
        if (!this.#drag) {
            return;
        }
        const previewed = this.#drag.previewed;
        this.#drag.session.cancel();
        this.#finishDrag(previewed ? false : null);
    }

    #finishDrag(committed) {
        const drag = this.#drag;
        if (!drag) {
            return;
        }
        if (this.#frame !== undefined) {
            cancelAnimationFrame(this.#frame);
            this.#frame = undefined;
        }
        if (drag.item.hasPointerCapture?.(drag.pointerId)) {
            drag.item.releasePointerCapture(drag.pointerId);
        }
        drag.item.style.transform = 'translate3d(0, 0, 0)';
        drag.item.style.transformOrigin = '';
        drag.item.style.cursor = 'grab';
        drag.item.style.zIndex = '';
        drag.item.style.borderColor = drag.id === this.#selectedId ? '#00eaff' : 'transparent';
        drag.item.style.background = 'transparent';
        this.#placeholder.style.display = 'none';
        this.#drag = null;
        for (const node of this.#nodes.values()) {
            node.style.transform = 'translate3d(0, 0, 0)';
        }
        if (committed === true) {
            this.#actions.commit();
        } else if (committed === false) {
            this.#actions.cancel();
        }
        this.refresh(this.#layout.rectangles(this.#panelLayout.gridRect), this.#panelLayout);
    }

    #pointerLocal(event) {
        const bounds = this.#overlay.getBoundingClientRect();
        const gridRect = this.#panelLayout.gridRect;
        return {
            x: bounds.width > 0 ? (event.clientX - bounds.left) * gridRect.width / bounds.width : 0,
            y: bounds.height > 0 ? (event.clientY - bounds.top) * gridRect.height / bounds.height : 0
        };
    }

    #resizeEdges(item, event) {
        const bounds = item.getBoundingClientRect();
        const hitX = Math.min(EDGE_HIT_SIZE, bounds.width * 0.24);
        const hitY = Math.min(EDGE_HIT_SIZE, bounds.height * 0.24);
        const left = event.clientX - bounds.left <= hitX;
        const right = bounds.right - event.clientX <= hitX;
        const top = event.clientY - bounds.top <= hitY;
        const bottom = bounds.bottom - event.clientY <= hitY;
        if (!(left || right || top || bottom)) {
            return null;
        }
        return {
            x: left ? -1 : right ? 1 : 0,
            y: top ? -1 : bottom ? 1 : 0
        };
    }

    #resizeCursor(edges) {
        if (!edges) {
            return 'grab';
        }
        if (edges.x === 0) {
            return 'ns-resize';
        }
        if (edges.y === 0) {
            return 'ew-resize';
        }
        return edges.x === edges.y ? 'nwse-resize' : 'nesw-resize';
    }

    #quantize(raw, current, min, max) {
        let value = current;
        while (value < max && raw > value + HYSTERESIS) {
            value += 1;
        }
        while (value > min && raw < value - HYSTERESIS) {
            value -= 1;
        }
        return value;
    }
}
