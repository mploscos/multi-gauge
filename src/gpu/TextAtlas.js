const DEFAULT_FONT_FAMILY = 'sans-serif';
const CHARACTERS = [...new Set(
    Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32)).join('')
    + '°…µ·'
)].join('');

const STYLE_DEFINITIONS = Object.freeze([
    { id: 'uiSmall', role: 'regular', logicalSize: 10, weight: 400 },
    { id: 'uiMedium', role: 'regular', logicalSize: 11, weight: 400 },
    { id: 'unitSmall', role: 'unit', logicalSize: 11, weight: 400 },
    { id: 'unitMedium', role: 'unit', logicalSize: 12, weight: 400 },
    { id: 'unitLarge', role: 'unit', logicalSize: 13, weight: 400 },
    { id: 'labelSmall', role: 'label', logicalSize: 10, weight: 600 },
    { id: 'labelMedium', role: 'label', logicalSize: 12, weight: 600 },
    { id: 'valueSmall', role: 'value', logicalSize: 17, weight: 600, tabular: true },
    { id: 'valueMedium', role: 'value', logicalSize: 23, weight: 500, tabular: true },
    { id: 'valueLarge', role: 'value', logicalSize: 29, weight: 500, tabular: true },
    { id: 'header', role: 'header', logicalSize: 16, weight: 600 }
]);

function nextPowerOfTwo(value) {
    let result = 1;
    while (result < value) {
        result *= 2;
    }
    return result;
}

function makeCanvas(width, height) {
    return typeof OffscreenCanvas === 'function'
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement('canvas'), { width, height });
}

function normalizeFontFamily(value) {
    const family = String(value ?? '').trim() || DEFAULT_FONT_FAMILY;
    if (family.includes(',') || family.includes('"') || family.includes("'") || !family.includes(' ')) {
        return family;
    }
    return `"${family}"`;
}

function fontString(style, pixelRatio, fontFamily) {
    return `${style.weight} ${style.logicalSize * pixelRatio}px ${fontFamily}`;
}

function finiteMetric(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

/** A DPR-aware bitmap atlas using the font family supplied by the host application. */
export class TextAtlas {
    static CHARACTERS = CHARACTERS;
    static STYLES = STYLE_DEFINITIONS;

    #device;
    #pixelRatio;
    #texture;
    #view;
    #sampler;
    #styles = new Map();
    #stylesByRole = new Map();
    #styleCache = new Map();
    #metricsCache = new Map();
    #measureCache = new Map();
    #fontFamily;

    constructor(device, pixelRatio = globalThis.devicePixelRatio || 1, fontFamily = DEFAULT_FONT_FAMILY) {
        this.#device = device;
        this.#pixelRatio = Math.max(1, Number(pixelRatio) || 1);
        this.#fontFamily = normalizeFontFamily(fontFamily);
    }

    get view() {
        return this.#view;
    }

    get sampler() {
        return this.#sampler;
    }

    get pixelRatio() {
        return this.#pixelRatio;
    }

    style(role = 'regular', size = 10) {
        const key = `${role}\0${size}`;
        const cached = this.#styleCache.get(key);
        if (cached) {
            return cached;
        }
        const candidates = this.#stylesByRole.get(role) ?? this.#stylesByRole.get('regular');
        const resolved = candidates.reduce((best, candidate) => {
            const distance = Math.abs(candidate.logicalSize - size);
            const bestDistance = Math.abs(best.logicalSize - size);
            return distance < bestDistance
                || (distance === bestDistance && candidate.logicalSize > best.logicalSize)
                ? candidate
                : best;
        });
        this.#styleCache.set(key, resolved);
        return resolved;
    }

    glyph(character, role = 'regular', size = 10) {
        const style = this.style(role, size);
        return style.glyphs.get(character) ?? style.glyphs.get('?');
    }

    metrics(size, role = 'regular') {
        const style = this.style(role, size);
        const key = `${style.id}\0${size}`;
        const cached = this.#metricsCache.get(key);
        if (cached) {
            return cached;
        }
        const scale = size / style.logicalSize / this.#pixelRatio;
        const metrics = {
            style: style.id,
            ascent: style.ascent * scale,
            descent: style.descent * scale,
            lineHeight: style.lineHeight * scale
        };
        this.#metricsCache.set(key, metrics);
        return metrics;
    }

    measure(text, size, role = 'regular') {
        const style = this.style(role, size);
        const value = String(text);
        const key = `${style.id}\0${size}\0${value}`;
        const cached = this.#measureCache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const scale = size / style.logicalSize / this.#pixelRatio;
        let width = 0;
        for (const character of value) {
            width += (style.glyphs.get(character) ?? style.glyphs.get('?')).advance * scale;
        }
        if (this.#measureCache.size >= 8192) {
            this.#measureCache.delete(this.#measureCache.keys().next().value);
        }
        this.#measureCache.set(key, width);
        return width;
    }

    async initialize() {
        await this.#waitForFont();
        const measurementCanvas = makeCanvas(1, 1);
        const measurement = measurementCanvas.getContext('2d', { alpha: true });
        measurement.textBaseline = 'alphabetic';
        measurement.fontKerning = 'none';
        const padding = Math.max(2, Math.ceil(this.#pixelRatio));
        const styles = STYLE_DEFINITIONS.map((definition) => this.#measureStyle(
            measurement,
            definition,
            padding
        ));
        const atlasWidth = 2048;
        let x = 1;
        let y = 1;
        let rowHeight = 0;
        for (const style of styles) {
            for (const glyph of style.glyphs.values()) {
                if (x + glyph.width + 1 > atlasWidth) {
                    x = 1;
                    y += rowHeight + 1;
                    rowHeight = 0;
                }
                glyph.x = x;
                glyph.y = y;
                x += glyph.width + 1;
                rowHeight = Math.max(rowHeight, glyph.height);
            }
        }
        const atlasHeight = nextPowerOfTwo(y + rowHeight + 1);
        const maxDimension = this.#device.limits?.maxTextureDimension2D ?? 8192;
        if (atlasHeight > maxDimension || atlasWidth > maxDimension) {
            throw new Error(`MultiGauge text atlas exceeds the GPU texture limit (${atlasWidth}×${atlasHeight}).`);
        }

        const canvas = makeCanvas(atlasWidth, atlasHeight);
        const context = canvas.getContext('2d', { alpha: true });
        context.clearRect(0, 0, atlasWidth, atlasHeight);
        context.fillStyle = '#ffffff';
        context.textBaseline = 'alphabetic';
        context.fontKerning = 'none';
        for (const style of styles) {
            context.font = fontString(style, this.#pixelRatio, this.#fontFamily);
            for (const [character, glyph] of style.glyphs) {
                if (character !== ' ') {
                    context.fillText(
                        character,
                        glyph.x + padding + glyph.left,
                        glyph.y + padding + glyph.ascent
                    );
                }
                glyph.u0 = glyph.x / atlasWidth;
                glyph.v0 = glyph.y / atlasHeight;
                glyph.u1 = (glyph.x + glyph.width) / atlasWidth;
                glyph.v1 = (glyph.y + glyph.height) / atlasHeight;
            }
            this.#styles.set(style.id, style);
            const roleStyles = this.#stylesByRole.get(style.role) ?? [];
            roleStyles.push(style);
            roleStyles.sort((a, b) => a.logicalSize - b.logicalSize);
            this.#stylesByRole.set(style.role, roleStyles);
        }

        this.#texture = this.#device.createTexture({
            label: `MultiGauge glyph atlas (${this.#fontFamily}) @${this.#pixelRatio}x`,
            size: [atlasWidth, atlasHeight],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
                | GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.#device.queue.copyExternalImageToTexture(
            { source: canvas },
            { texture: this.#texture },
            [atlasWidth, atlasHeight]
        );
        this.#view = this.#texture.createView();
        this.#sampler = this.#device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge'
        });
    }

    destroy() {
        this.#texture?.destroy();
        this.#styleCache.clear();
        this.#metricsCache.clear();
        this.#measureCache.clear();
    }

    async #waitForFont() {
        if (!globalThis.document?.fonts) {
            return;
        }
        await Promise.all([...new Set(STYLE_DEFINITIONS.map(({ weight }) => weight))]
            .map((weight) => document.fonts.load(
                `${weight} 16px ${this.#fontFamily}`,
                'Hgm0123°µ·'
            )));
        await document.fonts.ready;
    }

    #measureStyle(context, definition, padding) {
        const style = { ...definition, glyphs: new Map() };
        context.font = fontString(style, this.#pixelRatio, this.#fontFamily);
        const records = [];
        for (const character of CHARACTERS) {
            const metrics = context.measureText(character);
            const left = finiteMetric(metrics.actualBoundingBoxLeft);
            const right = finiteMetric(metrics.actualBoundingBoxRight, metrics.width);
            const ascent = Math.max(0, finiteMetric(metrics.actualBoundingBoxAscent,
                style.logicalSize * this.#pixelRatio * 0.8));
            const descent = Math.max(0, finiteMetric(metrics.actualBoundingBoxDescent,
                style.logicalSize * this.#pixelRatio * 0.2));
            const inkWidth = character === ' ' ? 0 : Math.max(1, Math.ceil(left + right));
            const inkHeight = character === ' ' ? 0 : Math.max(1, Math.ceil(ascent + descent));
            const record = {
                character,
                left,
                ascent,
                descent,
                bearingLeft: left + padding,
                bearingTop: ascent + padding,
                width: Math.max(1, inkWidth + padding * 2),
                height: Math.max(1, inkHeight + padding * 2),
                advance: Math.max(1, metrics.width),
                offsetX: 0
            };
            records.push(record);
            style.glyphs.set(character, record);
        }
        if (style.tabular) {
            const digitAdvance = Math.max(...[...'0123456789']
                .map((digit) => style.glyphs.get(digit).advance));
            for (const digit of '0123456789') {
                const glyph = style.glyphs.get(digit);
                glyph.offsetX = (digitAdvance - glyph.advance) / 2;
                glyph.advance = digitAdvance;
            }
        }
        const sample = context.measureText('Hgjpqy°µ');
        style.ascent = Math.max(
            finiteMetric(sample.fontBoundingBoxAscent),
            ...records.map((record) => record.ascent)
        );
        style.descent = Math.max(
            finiteMetric(sample.fontBoundingBoxDescent),
            ...records.map((record) => record.descent)
        );
        style.lineHeight = style.ascent + style.descent;
        return style;
    }
}
