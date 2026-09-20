import { MultiGaugeError } from './errors.js';
import { GridLayout } from './layout/GridLayout.js';
import { layoutPanel } from './layout/PanelLayout.js';
import { coerceValue, normalizeGauge, serializeGauge, setGaugeMarker } from './model/GaugeModel.js';
import { Renderer } from './gpu/Renderer.js';
import { SharedGpuRuntime } from './gpu/GpuRuntime.js';
import { GridEditor } from './interaction/GridEditor.js';
import { resolveTheme } from './theme.js';

/** A source-agnostic WebGPU panel containing multiple realtime gauges. */
export class MultiGauge {
    #canvas;
    #runtime;
    #renderer;
    #layout;
    #gauges = new Map();
    #header;
    #accent;
    #theme;
    #frame;
    #staticDirty = true;
    #dynamicDirty = true;
    #destroyed = false;
    #resizeObserver;
    #width = 1;
    #height = 1;
    #panelLayout = layoutPanel({ width: 1, height: 1 });
    #editor;
    #previewEntries;
    #stats = { updatesReceived: 0, rendersCoalesced: 0 };

    /** Create a panel after the shared WebGPU runtime is ready. */
    static async create(canvas, options = {}) {
        if (!canvas || typeof canvas.getContext !== 'function') {
            throw new MultiGaugeError('MultiGauge.create() requires a canvas.');
        }
        const runtime = await SharedGpuRuntime.get();
        const panel = new MultiGauge(canvas, options, runtime);
        panel.#initialize();
        return panel;
    }

    constructor(canvas, options, runtime) {
        this.#canvas = canvas;
        this.#runtime = runtime;
        this.#layout = new GridLayout(options.grid);
        this.#accent = options.accent ?? '#00eaff';
        this.#theme = resolveTheme(options.theme, this.#accent);
        this.#header = options.header ? { ...options.header } : null;
        this.#renderer = new Renderer(canvas, runtime, (all) => this.#invalidate(all));
        for (const gauge of options.gauges ?? []) {
            this.#addNow(gauge);
        }
    }

    /** Add a gauge, auto-placing it when row/col are omitted. */
    add(configuration) {
        this.#assertAlive();
        const gauge = this.#addNow(configuration);
        this.#invalidate(true);
        return { ...gauge };
    }

    /** Remove a gauge and free its cell occupancy. */
    remove(id) {
        this.#assertAlive();
        if (!this.#gauges.delete(id)) {
            return false;
        }
        this.#layout.remove(id);
        this.#invalidate(true);
        return true;
    }

    /** Set one signal value. Numeric values clamp; compass values wrap. */
    set(id, value) {
        this.#assertAlive();
        const gauge = this.#gauges.get(id);
        if (!gauge) {
            throw new MultiGaugeError(`Unknown gauge: ${id}.`);
        }
        this.#stats.updatesReceived += 1;
        const next = coerceValue(gauge, value);
        if (!Object.is(next, gauge.value)) {
            gauge.value = next;
            this.#dynamicDirty = true;
            this.#schedule();
        }
        return this;
    }

    /** Set several signals; all changes are coalesced into one animation frame. */
    update(values) {
        this.#assertAlive();
        for (const [id, value] of Object.entries(values)) {
            this.set(id, value);
        }
        return this;
    }

    /** Add or update a marker by id. */
    setMarker(gaugeId, markerId, value, options = {}) {
        this.#assertAlive();
        const gauge = this.#gauges.get(gaugeId);
        if (!gauge) {
            throw new MultiGaugeError(`Unknown gauge: ${gaugeId}.`);
        }
        setGaugeMarker(gauge, markerId, value, options);
        this.#invalidate(true);
        return this;
    }

    move(id, row, col) {
        this.#assertAlive();
        const result = this.#layout.move(id, row, col);
        if (result) {
            this.#invalidate(true);
        }
        return Boolean(result);
    }

    resize(id, rowSpan, colSpan) {
        this.#assertAlive();
        const result = this.#layout.resize(id, rowSpan, colSpan);
        if (result) {
            this.#invalidate(true);
        }
        return Boolean(result);
    }

    maximize(id) {
        this.#assertAlive();
        this.#layout.maximize(id);
        this.#invalidate(true);
        return this;
    }

    minimize(id) {
        this.#assertAlive();
        const result = this.#layout.minimize(id);
        if (result) {
            this.#invalidate(true);
        }
        return Boolean(result);
    }

    restoreGauge(id) {
        this.#assertAlive();
        const result = this.#layout.restore(id);
        if (result) {
            this.#invalidate(true);
        }
        return Boolean(result);
    }

    /** Enable or disable direct layout manipulation. Enabled by default. */
    setEditing(enabled) {
        this.#assertAlive();
        if (enabled && !this.#editor) {
            this.#editor = new GridEditor(this.#canvas, this.#layout, {
                preview: (entries) => this.#setLayoutPreview(entries),
                commit: () => this.#finishLayoutPreview(),
                cancel: () => this.#finishLayoutPreview()
            });
            this.#refreshEditor();
        } else if (!enabled && this.#editor) {
            this.#editor.destroy();
            this.#editor = null;
        }
        return this;
    }

    /** Return clean JSON-compatible public state. */
    serialize() {
        this.#assertAlive();
        return {
            version: 1,
            grid: this.#layout.config,
            accent: this.#accent,
            theme: { ...this.#theme },
            header: this.#header ? {
                ...this.#header,
                icon: this.#header.icon instanceof URL ? this.#header.icon.href : this.#header.icon
            } : null,
            gauges: [...this.#gauges.values()].map((gauge) => serializeGauge(gauge, this.#layout.get(gauge.id)))
        };
    }

    /** Atomically replace public configuration from serialized state. */
    restore(state) {
        this.#assertAlive();
        if (!state || !Array.isArray(state.gauges)) {
            throw new MultiGaugeError('Invalid serialized MultiGauge state.');
        }
        const layout = new GridLayout(state.grid);
        const gauges = new Map();
        for (const input of state.gauges) {
            const gauge = normalizeGauge(input);
            if (gauges.has(gauge.id)) {
                throw new MultiGaugeError(`Gauge id already exists: ${gauge.id}.`);
            }
            layout.add(gauge.id, gauge);
            gauges.set(gauge.id, gauge);
        }
        this.#layout = layout;
        this.#previewEntries = undefined;
        this.#gauges = gauges;
        this.#accent = state.accent ?? '#00eaff';
        this.#theme = resolveTheme(state.theme, this.#accent);
        this.#header = state.header ? { ...state.header } : null;
        if (this.#editor) {
            this.#editor.destroy();
            this.#editor = null;
            this.setEditing(true);
        }
        this.#invalidate(true);
        return this;
    }

    /** Lightweight counters intended for demos and diagnostics. */
    getStats() {
        return {
            ...this.#stats,
            ...this.#renderer.stats,
            runtimeGeneration: this.#runtime.generation
        };
    }

    destroy() {
        if (this.#destroyed) {
            return;
        }
        this.#destroyed = true;
        if (this.#frame !== undefined) {
            cancelAnimationFrame(this.#frame);
        }
        this.#resizeObserver?.disconnect();
        this.#editor?.destroy();
        this.#renderer.destroy();
        this.#gauges.clear();
    }

    #initialize() {
        const resize = () => {
            const style = getComputedStyle(this.#canvas);
            const horizontalPadding = (Number.parseFloat(style.paddingLeft) || 0)
                + (Number.parseFloat(style.paddingRight) || 0);
            const verticalPadding = (Number.parseFloat(style.paddingTop) || 0)
                + (Number.parseFloat(style.paddingBottom) || 0);
            this.#width = Math.max(1, this.#canvas.clientWidth - horizontalPadding
                || this.#canvas.width || 1);
            this.#height = Math.max(1, this.#canvas.clientHeight - verticalPadding
                || this.#canvas.height || 1);
            if (this.#renderer.resize(this.#width, this.#height)) {
                this.#invalidate(true);
            }
        };
        if (typeof ResizeObserver === 'function') {
            this.#resizeObserver = new ResizeObserver(resize);
            this.#resizeObserver.observe(this.#canvas);
        }
        resize();
        this.setEditing(true);
        this.#invalidate(true);
    }

    #addNow(configuration) {
        const gauge = normalizeGauge(configuration);
        if (this.#gauges.has(gauge.id)) {
            throw new MultiGaugeError(`Gauge id already exists: ${gauge.id}.`);
        }
        this.#layout.add(gauge.id, gauge);
        this.#gauges.set(gauge.id, gauge);
        return gauge;
    }

    #invalidate(all) {
        if (this.#destroyed) {
            return;
        }
        this.#staticDirty ||= all;
        this.#dynamicDirty = true;
        this.#schedule();
    }

    #schedule() {
        if (this.#frame !== undefined) {
            this.#stats.rendersCoalesced += 1;
            return;
        }
        this.#frame = requestAnimationFrame(() => {
            this.#frame = undefined;
            this.#render();
        });
    }

    #render() {
        if (this.#destroyed || (!this.#staticDirty && !this.#dynamicDirty)) {
            return;
        }
        this.#panelLayout = layoutPanel({
            width: this.#width,
            height: this.#height,
            hasHeader: Boolean(this.#header)
        });
        const previewing = Boolean(this.#previewEntries);
        const rectangles = this.#previewEntries
            ? this.#layout.rectangles(this.#panelLayout.gridRect, this.#previewEntries)
            : this.#layout.rectangles(this.#panelLayout.gridRect);
        const refreshEditor = this.#staticDirty && !previewing;
        let gauges = [...this.#gauges.values()];
        const maximized = gauges.find((gauge) => this.#layout.get(gauge.id)?.maximized);
        if (maximized) {
            gauges = [maximized];
        }
        if (this.#staticDirty) {
            this.#renderer.rebuildStatic(gauges, rectangles, this.#header, this.#theme, this.#panelLayout);
        }
        if (this.#dynamicDirty) {
            this.#renderer.updateDynamic(gauges, this.#theme);
        }
        this.#renderer.render(this.#theme);
        this.#staticDirty = false;
        this.#dynamicDirty = false;
        if (refreshEditor) {
            this.#refreshEditor(rectangles);
        }
    }

    #setLayoutPreview(entries) {
        this.#previewEntries = entries;
        this.#invalidate(true);
    }

    #finishLayoutPreview() {
        this.#previewEntries = undefined;
        this.#invalidate(true);
    }

    #refreshEditor(rectangles) {
        if (!this.#editor) {
            return;
        }
        this.#panelLayout = layoutPanel({
            width: this.#width,
            height: this.#height,
            hasHeader: Boolean(this.#header)
        });
        const actualRectangles = rectangles ?? this.#layout.rectangles(this.#panelLayout.gridRect);
        this.#editor.refresh(actualRectangles, this.#panelLayout);
    }

    #assertAlive() {
        if (this.#destroyed) {
            throw new MultiGaugeError('This MultiGauge has been destroyed.');
        }
    }
}
