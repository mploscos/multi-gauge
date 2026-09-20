export type MultiGaugeGrid = {
    rows?: number;
    columns?: number;
    gap?: number;
};

export const SEMANTIC_KINDS: readonly [
    'normal',
    'warning',
    'critical',
    'inactive',
    'target'
];

export type MultiGaugeState = {
    version?: number;
    grid?: MultiGaugeGrid;
    accent?: string;
    theme?: Record<string, unknown>;
    header?: Record<string, unknown> | null;
    gauges?: Array<Record<string, any>>;
};

export type MultiGaugeOptions = MultiGaugeState & {
    fontFamily?: string;
};

export class MultiGaugeError extends Error {}

export class MultiGauge extends EventTarget {
    static create(canvas: HTMLCanvasElement, options?: MultiGaugeOptions): Promise<MultiGauge>;
    add(configuration: Record<string, any>): Record<string, any>;
    remove(id: string): boolean;
    set(id: string, value: unknown): this;
    update(values: Record<string, unknown>): this;
    setMarker(gaugeId: string, markerId: string, value: unknown, options?: Record<string, any>): this;
    configure(id: string, patch?: Record<string, any>): Record<string, any>;
    setAccents(accents?: Record<string, string>): this;
    select(id?: string | null): this;
    move(id: string, row: number, col: number): boolean;
    resize(id: string, rowSpan: number, colSpan: number): boolean;
    maximize(id: string): this;
    minimize(id: string): boolean;
    restoreGauge(id: string): boolean;
    setGrid(configuration?: MultiGaugeGrid): this;
    setEditing(enabled: boolean): this;
    serialize(): Record<string, any>;
    restore(state: MultiGaugeState): this;
    getStats(): Record<string, number>;
    destroy(): void;
}
