import { fitText, layoutCell } from '../layout/CellLayout.js';
import { layoutHeader } from '../layout/PanelLayout.js';
import { normalizeValue, projectBand, resolveBand, resolveStatus } from '../model/GaugeModel.js';
import { color, semanticColor } from '../theme.js';

const TAU = Math.PI * 2;
const BAND_THICKNESS = 2;
const RADIAL_BAND_LABEL_OFFSET = 12;
const RADIAL_TARGET_LABEL_OFFSET = 36;
const RADIAL_BAND_LABEL_SPACE = 20;
const RADIAL_TARGET_LABEL_SPACE = 44;
const MIN_RADIAL_RADIUS = 12;
const RADIAL_TRACK_INSET = 8;
const RADIAL_TICK_GAP = 3;
const radians = (degrees) => degrees * Math.PI / 180;
export const TEXT_INSTANCE_SIZE = 16;

function tangentTextAngle(angle) {
    return Math.cos(angle) < 0 ? angle + Math.PI : angle;
}

function radialBaseSpace(halfExtent) {
    return Math.min(10, Math.max(5, halfExtent * 0.1));
}

function canReserveRadialTier(halfExtent, baseRadius, space) {
    const candidate = halfExtent - space;
    return candidate >= Math.max(24, baseRadius * 0.58);
}

function labelFits(atlas, value, maxWidth) {
    return maxWidth > 0 && atlas.measure(String(value), 8, 'label') <= maxWidth;
}

function fitOptionalLabel(atlas, value, maxWidth) {
    const fitted = fitText(value, maxWidth, {
        targetSize: 9,
        minSize: 8,
        measure: (text, size, font) => atlas.measure(text, size, font),
        font: 'label'
    });
    return fitted.text && !fitted.truncated ? fitted : null;
}

function compassBandData(gauge, band) {
    const range = gauge.max - gauge.min;
    const segments = projectBand(band, gauge.min, gauge.max, true);
    const lengths = segments.map(([from, to]) => (to - from) / range);
    const total = lengths.reduce((sum, length) => sum + length, 0);
    let remaining = total / 2;
    let midpoint = segments[0][0];
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const [from, to] = segments[segmentIndex];
        if (remaining <= lengths[segmentIndex]) {
            midpoint = from + remaining * range;
            break;
        }
        remaining -= lengths[segmentIndex];
    }
    return { band, segments, total, midpoint };
}

function shape(output, geometry, rgba, parameters, extra = [0, 0, 0, 0]) {
    output.push(...geometry, ...rgba, ...parameters, ...extra, 0, 0, 0, 0);
}

function arc(output, x, y, radius, thickness, start, end, rgba, gaugeIndex = 0, dynamicMode = 0) {
    shape(output, [x, y, radius + 3, radius + 3], rgba, [1, start, end, radius - thickness],
        [radius, gaugeIndex, dynamicMode, 0]);
}

function box(output, x, y, width, height, rgba, radius = 0, border = 0, gaugeIndex = 0, dynamicMode = 0) {
    shape(output, [x + width / 2, y + height / 2, width / 2, height / 2], rgba,
        [0, radius, border, 0], [0, gaugeIndex, dynamicMode, 0]);
}

function capsule(output, x, y, width, height, rgba, gaugeIndex = 0, dynamicMode = 0) {
    shape(output, [x + width / 2, y + height / 2, width / 2, height / 2], rgba,
        [2, 0, 0, 0], [0, gaugeIndex, dynamicMode, 0]);
}

function dynamicMarker(output, rect, rgba, gaugeIndex, vertical) {
    shape(output, [rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width / 2, rect.height / 2],
        rgba, [3, 1.2, 0, 0], [0, gaugeIndex, vertical ? 5 : 4, 0]);
}

function compassMarker(output, cx, cy, radius, rgba, gaugeIndex) {
    const scale = Math.min(1, Math.max(0.55, radius / 64));
    const extent = radius + 8;
    shape(output, [cx, cy, extent, extent], rgba,
        [6, 2.5 * scale, radius, 7 * scale], [0, gaugeIndex, 7, 0]);
}

function radialStroke(
    output,
    cx,
    cy,
    markerRadius,
    angle,
    halfWidth,
    halfLength,
    rgba,
    gaugeIndex
) {
    const extent = markerRadius + halfLength + 2;
    shape(output, [cx, cy, extent, extent], rgba,
        [7, halfWidth, markerRadius, halfLength], [angle, gaugeIndex, 0, 0]);
}

function radialMarker(output, cx, cy, radius, angle, rgba, gaugeIndex) {
    const scale = Math.min(1, Math.max(0.55, radius / 64));
    radialStroke(output, cx, cy, radius + 5 * scale, angle,
        2 * scale, 8 * scale, rgba, gaugeIndex);
}

function radialTick(output, cx, cy, radius, angle, major, rgba, gaugeIndex) {
    if (radius < 30) {
        return;
    }
    const scale = Math.min(1, Math.max(0.55, radius / 64));
    const halfLength = (major ? 5 : 3.5) * scale;
    const outerRadius = radius - RADIAL_TRACK_INSET - RADIAL_TICK_GAP;
    radialStroke(output, cx, cy, outerRadius - halfLength, angle,
        (major ? 1.15 : 0.8) * scale, halfLength, rgba, gaugeIndex);
}

function textWidth(atlas, value, size, font = 'regular') {
    return atlas.measure(value, size, font);
}

function snapToPhysicalPixel(value, pixelRatio) {
    return Math.round(value * pixelRatio) / pixelRatio;
}

export function addText(
    atlas,
    output,
    value,
    x,
    y,
    size,
    rgba,
    align = 'left',
    font = 'regular',
    verticalPosition = 'top',
    rotation = 0
) {
    const string = String(value);
    const style = atlas.style(font, size);
    const pixelRatio = atlas.pixelRatio;
    const scale = size / style.logicalSize / pixelRatio;
    let cursor = x;
    const measured = textWidth(atlas, string, size, font);
    if (align === 'center') {
        cursor -= measured / 2;
    } else if (align === 'right') {
        cursor -= measured;
    }
    const metrics = atlas.metrics(size, font);
    const baseline = snapToPhysicalPixel(
        verticalPosition === 'baseline' ? y : y + metrics.ascent,
        pixelRatio
    );
    const pivotY = verticalPosition === 'baseline'
        ? y + (metrics.descent - metrics.ascent) / 2
        : y + metrics.lineHeight / 2;
    const rotated = rotation !== 0;
    const cos = rotated ? Math.cos(rotation) : 1;
    const sin = rotated ? Math.sin(rotation) : 0;
    const glyphs = style.glyphs;
    const fallback = glyphs?.get('?');
    for (const character of string) {
        const glyph = glyphs?.get(character) ?? fallback ?? atlas.glyph(character, font, size);
        if (character !== ' ') {
            const left = snapToPhysicalPixel(
                cursor + (glyph.offsetX - glyph.bearingLeft) * scale,
                pixelRatio
            );
            const top = snapToPhysicalPixel(baseline - glyph.bearingTop * scale, pixelRatio);
            const right = snapToPhysicalPixel(left + glyph.width * scale, pixelRatio);
            const bottom = snapToPhysicalPixel(top + glyph.height * scale, pixelRatio);
            const centerX = (left + right) / 2;
            const centerY = (top + bottom) / 2;
            const dx = centerX - x;
            const dy = centerY - pivotY;
            const offset = output.length;
            output.length = offset + TEXT_INSTANCE_SIZE;
            output[offset] = rotated ? x + dx * cos - dy * sin : centerX;
            output[offset + 1] = rotated ? pivotY + dx * sin + dy * cos : centerY;
            output[offset + 2] = (right - left) / 2;
            output[offset + 3] = (bottom - top) / 2;
            output[offset + 4] = glyph.u0;
            output[offset + 5] = glyph.v0;
            output[offset + 6] = glyph.u1;
            output[offset + 7] = glyph.v1;
            output[offset + 8] = rgba[0];
            output[offset + 9] = rgba[1];
            output[offset + 10] = rgba[2];
            output[offset + 11] = rgba[3];
            output[offset + 12] = cos;
            output[offset + 13] = sin;
            output[offset + 14] = 0;
            output[offset + 15] = 0;
        }
        cursor += glyph.advance * scale;
    }
}

function absoluteCellLayout(rect, gauge) {
    const layout = layoutCell({
        width: rect.width,
        height: rect.height,
        gaugeType: gauge.type,
        orientation: gauge.orientation,
        hasInfo: Boolean(gauge.info),
        hasUnit: Boolean(gauge.unit),
        hasMarkers: gauge.markers.length > 0,
        hasMarkerLabels: gauge.markers.some((marker) => Boolean(marker.label)),
        hasBandLabels: gauge.bands.some((band) => Boolean(band.label))
    });
    const absolute = { ...layout };
    for (const name of ['metaRect', 'labelRect', 'infoRect', 'gaugeRect', 'readoutRect']) {
        absolute[name] = {
            ...layout[name],
            x: rect.x + layout[name].x,
            y: rect.y + layout[name].y
        };
    }
    return absolute;
}

function addArcGauge(scene, gauge, rect, theme, index, layout) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const halfExtent = Math.min(rect.width, rect.height) / 2;
    const start = radians(gauge.startAngle);
    const end = radians(gauge.endAngle);
    const baseSpace = radialBaseSpace(halfExtent);
    const baseRadius = Math.max(MIN_RADIAL_RADIUS, halfExtent - baseSpace);
    const markerRadius = halfExtent - RADIAL_TARGET_LABEL_SPACE;
    const markerLabelWidth = Math.min(markerRadius, rect.width * 0.4);
    const showMarkerLabels = layout.showMarkerLabels
        && canReserveRadialTier(halfExtent, baseRadius, RADIAL_TARGET_LABEL_SPACE)
        && gauge.markers.some((marker) => marker.label
            && labelFits(scene.atlas, marker.label, markerLabelWidth));
    const bandRadius = halfExtent - (showMarkerLabels
        ? RADIAL_TARGET_LABEL_SPACE
        : RADIAL_BAND_LABEL_SPACE);
    const bandLabelFits = (band) => {
        if (!band.label) {
            return false;
        }
        const fromAngle = start + normalizeValue(gauge, band.from) * (end - start);
        const toAngle = start + normalizeValue(gauge, band.to) * (end - start);
        const labelRadius = bandRadius + RADIAL_BAND_LABEL_OFFSET;
        return labelFits(scene.atlas, band.label, Math.max(0, Math.min(
            bandRadius * 1.2,
            Math.abs(toAngle - fromAngle) * labelRadius
        )));
    };
    const showBandLabels = layout.showBandLabels
        && (showMarkerLabels
            || canReserveRadialTier(halfExtent, baseRadius, RADIAL_BAND_LABEL_SPACE))
        && gauge.bands.some(bandLabelFits);
    const labelSpace = showMarkerLabels
        ? RADIAL_TARGET_LABEL_SPACE
        : showBandLabels ? RADIAL_BAND_LABEL_SPACE : baseSpace;
    const radius = Math.max(MIN_RADIAL_RADIUS, halfExtent - labelSpace);
    arc(scene.shapes, cx, cy, radius, 3, start, end, color(theme.grid), index);
    if (layout.showTicks) {
        for (let tick = 0; tick <= 10; tick += 1) {
            const angle = start + tick / 10 * (end - start);
            radialTick(scene.shapes, cx, cy, radius, angle,
                tick === 0 || tick === 5 || tick === 10,
                color(theme.muted, layout.typography.ticks.alpha), index);
        }
    }
    for (const band of gauge.bands) {
        for (const [from, to] of projectBand(band, gauge.min, gauge.max)) {
            const fromAngle = start + normalizeValue(gauge, from) * (end - start);
            const toAngle = start + normalizeValue(gauge, to) * (end - start);
            arc(scene.shapes, cx, cy, radius + 6, BAND_THICKNESS,
                fromAngle,
                toAngle,
                semanticColor(theme, band.kind, 'normal'), index);
            if (showBandLabels && band.label) {
                const angle = (fromAngle + toAngle) / 2;
                const labelRadius = radius + RADIAL_BAND_LABEL_OFFSET;
                const available = Math.max(0, Math.min(
                    radius * 1.2,
                    Math.abs(toAngle - fromAngle) * labelRadius
                ));
                const fitted = fitOptionalLabel(scene.atlas, band.label, available);
                if (fitted) {
                    addText(scene.atlas, scene.text, fitted.text,
                        cx + Math.sin(angle) * labelRadius,
                        cy - Math.cos(angle) * labelRadius - fitted.size / 2,
                        fitted.size, semanticColor(theme, band.kind, 'normal'),
                        'center', 'label', 'top', tangentTextAngle(angle));
                }
            }
        }
    }
    arc(scene.shapes, cx, cy, radius, 8, start, end, color(theme.accent, 0.12), index, 1);
    arc(scene.shapes, cx, cy, radius, 3, start, end, color(theme.accent), index, 1);
    for (const marker of gauge.markers) {
        const angle = start + normalizeValue(gauge, marker.value) * (end - start);
        radialMarker(scene.shapes, cx, cy, radius, angle,
            semanticColor(theme, marker.kind, 'target'), index);
        if (showMarkerLabels && marker.label) {
            const labelRadius = radius + RADIAL_TARGET_LABEL_OFFSET;
            const fitted = fitOptionalLabel(
                scene.atlas,
                marker.label,
                Math.min(radius, rect.width * 0.4)
            );
            if (fitted) {
                addText(scene.atlas, scene.text, fitted.text,
                    cx + Math.sin(angle) * labelRadius,
                    cy - Math.cos(angle) * labelRadius - fitted.size / 2,
                    fitted.size, semanticColor(theme, marker.kind, 'target'),
                    'center', 'label');
            }
        }
    }
}

function addLinearGauge(scene, gauge, rect, theme, index, layout) {
    const vertical = gauge.orientation === 'vertical';
    const length = vertical ? Math.max(1, rect.height - 14) : rect.width * 0.78;
    const thickness = Math.max(5, Math.min(18, vertical ? rect.width * 0.13 : rect.height * 0.18));
    const bandLabelSpace = vertical && layout.showBandLabels
        ? Math.min(56, rect.width * 0.45)
        : 0;
    const x = vertical
        ? rect.x + rect.width - thickness - bandLabelSpace
        : rect.x + (rect.width - length) / 2;
    const y = vertical ? rect.y + (rect.height - length) / 2 : rect.y + (rect.height - thickness) / 2;
    const width = vertical ? thickness : length;
    const height = vertical ? length : thickness;
    capsule(scene.shapes, x, y, width, height, color(theme.grid), index);
    if (layout.showTicks) {
        for (let tick = 0; tick <= 10; tick += 1) {
            const position = tick / 10;
            const major = tick === 0 || tick === 5 || tick === 10;
            if (vertical) {
                const tickWidth = major ? 7 : 4;
                capsule(scene.shapes, x - tickWidth - 2, y + height * (1 - position) - 0.5,
                    tickWidth, 1, color(theme.muted, layout.typography.ticks.alpha), index);
            } else {
                const tickHeight = major ? 7 : 4;
                capsule(scene.shapes, x + width * position - 0.5, y - tickHeight - 2,
                    1, tickHeight, color(theme.muted, layout.typography.ticks.alpha), index);
            }
        }
    }
    for (const band of gauge.bands) {
        const from = normalizeValue(gauge, band.from);
        const to = normalizeValue(gauge, band.to);
        const rgba = semanticColor(theme, band.kind, 'normal');
        if (vertical) {
            capsule(scene.shapes, x + width + 5, y + height * (1 - Math.max(from, to)),
                BAND_THICKNESS, height * Math.abs(to - from), rgba, index);
        } else {
            capsule(scene.shapes, x + width * Math.min(from, to), y + height + 5,
                width * Math.abs(to - from), BAND_THICKNESS, rgba, index);
        }
        if (layout.showBandLabels && band.label) {
            const midpoint = (from + to) / 2;
            if (vertical) {
                const labelX = x + width + 9;
                const available = Math.max(0, rect.x + rect.width - labelX);
                const fitted = fitOptionalLabel(scene.atlas, band.label, available);
                if (fitted) {
                    addText(scene.atlas, scene.text, fitted.text, labelX,
                        y + height * (1 - midpoint) - fitted.size / 2,
                        fitted.size, rgba, 'left', 'label');
                }
            } else {
                const available = width * Math.abs(to - from);
                const fitted = fitOptionalLabel(scene.atlas, band.label, available);
                if (fitted) {
                    addText(scene.atlas, scene.text, fitted.text, x + width * midpoint,
                        y + height + 9, fitted.size, rgba, 'center', 'label');
                }
            }
        }
    }
    if (gauge.mode === 'fill' || gauge.mode === 'fill-marker') {
        capsule(scene.shapes, x, y, width, height, color(theme.accent), index, vertical ? 3 : 2);
    }
    if (gauge.mode === 'marker' || gauge.mode === 'fill-marker') {
        const markerRect = vertical
            ? { x: x - 4, y, width: width + 8, height }
            : { x, y: y - 4, width, height: height + 8 };
        dynamicMarker(scene.shapes, markerRect, color(theme.accent), index, vertical);
    }
    for (const marker of gauge.markers) {
        const normalized = normalizeValue(gauge, marker.value);
        const rgba = semanticColor(theme, marker.kind, 'target');
        if (vertical) {
            capsule(scene.shapes, x - 5, y + height * (1 - normalized) - 1, width + 10, 2,
                rgba, index);
        } else {
            capsule(scene.shapes, x + width * normalized - 1, y - 5, 2, height + 10,
                rgba, index);
        }
        if (layout.showMarkerLabels && marker.label) {
            if (vertical) {
                const available = Math.max(0, x - rect.x - 9);
                const fitted = fitOptionalLabel(scene.atlas, marker.label, available);
                if (fitted) addText(scene.atlas, scene.text, fitted.text, x - 8,
                    y + height * (1 - normalized) - fitted.size / 2,
                    fitted.size, rgba, 'right', 'label');
            } else {
                const fitted = fitOptionalLabel(scene.atlas, marker.label, Math.min(80, rect.width * 0.32));
                if (fitted) addText(scene.atlas, scene.text, fitted.text,
                    x + width * normalized, y - fitted.size - 10,
                    fitted.size, rgba, 'center', 'label');
            }
        }
    }
}

function addCompass(scene, gauge, rect, theme, index, layout) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const halfExtent = Math.min(rect.width, rect.height) / 2;
    const baseSpace = radialBaseSpace(halfExtent);
    const baseRadius = Math.max(MIN_RADIAL_RADIUS, halfExtent - baseSpace);
    const markerRadius = halfExtent - RADIAL_TARGET_LABEL_SPACE;
    const markerLabelWidth = Math.min(markerRadius, rect.width * 0.4);
    const showMarkerLabels = layout.showMarkerLabels
        && canReserveRadialTier(halfExtent, baseRadius, RADIAL_TARGET_LABEL_SPACE)
        && gauge.markers.some((marker) => marker.label
            && labelFits(scene.atlas, marker.label, markerLabelWidth));
    const projectedBands = gauge.bands.map((band) => compassBandData(gauge, band));
    const bandRadius = halfExtent - (showMarkerLabels
        ? RADIAL_TARGET_LABEL_SPACE
        : RADIAL_BAND_LABEL_SPACE);
    const showBandLabels = layout.showBandLabels
        && (showMarkerLabels
            || canReserveRadialTier(halfExtent, baseRadius, RADIAL_BAND_LABEL_SPACE))
        && projectedBands.some(({ band, total }) => band.label
            && labelFits(scene.atlas, band.label, Math.max(0, Math.min(
                bandRadius * 1.2,
                total * TAU * (bandRadius + RADIAL_BAND_LABEL_OFFSET)
            ))));
    const labelSpace = showMarkerLabels
        ? RADIAL_TARGET_LABEL_SPACE
        : showBandLabels ? RADIAL_BAND_LABEL_SPACE : baseSpace;
    const radius = Math.max(MIN_RADIAL_RADIUS, halfExtent - labelSpace);
    arc(scene.shapes, cx, cy, radius, 2, 0, TAU, color(theme.grid), index);
    for (const { band, segments, total, midpoint } of projectedBands) {
        for (const [from, to] of segments) {
            arc(scene.shapes, cx, cy, radius + 5, BAND_THICKNESS,
                normalizeValue(gauge, from) * TAU,
                normalizeValue(gauge, to === gauge.max ? gauge.min : to) * TAU
                    + (to === gauge.max ? TAU : 0),
                semanticColor(theme, band.kind, 'normal'), index);
        }
        if (showBandLabels && band.label) {
            const angle = normalizeValue(gauge, midpoint) * TAU;
            const labelRadius = radius + RADIAL_BAND_LABEL_OFFSET;
            const available = Math.max(0, Math.min(radius * 1.2, total * TAU * labelRadius));
            const fitted = fitOptionalLabel(scene.atlas, band.label, available);
            if (fitted) {
                addText(scene.atlas, scene.text, fitted.text,
                    cx + Math.sin(angle) * labelRadius,
                    cy - Math.cos(angle) * labelRadius - fitted.size / 2,
                    fitted.size, semanticColor(theme, band.kind, 'normal'),
                    'center', 'label', 'top', tangentTextAngle(angle));
            }
        }
    }
    if (layout.showTicks) {
        for (let tick = 0; tick < 12; tick += 1) {
            if (tick % 3 === 0) {
                continue;
            }
            const angle = tick / 12 * TAU;
            radialTick(scene.shapes, cx, cy, radius, angle, false,
                color(theme.muted, layout.typography.ticks.alpha), index);
        }
    }
    for (const marker of gauge.markers) {
        const angle = normalizeValue(gauge, marker.value) * TAU;
        radialMarker(scene.shapes, cx, cy, radius, angle,
            semanticColor(theme, marker.kind, 'target'), index);
        if (showMarkerLabels && marker.label) {
            const labelRadius = radius + RADIAL_TARGET_LABEL_OFFSET;
            const fitted = fitOptionalLabel(
                scene.atlas,
                marker.label,
                Math.min(radius, rect.width * 0.4)
            );
            if (fitted) {
                addText(scene.atlas, scene.text, fitted.text,
                    cx + Math.sin(angle) * labelRadius,
                    cy - Math.cos(angle) * labelRadius - fitted.size / 2,
                    fitted.size, semanticColor(theme, marker.kind, 'target'),
                    'center', 'label');
            }
        }
    }
    compassMarker(scene.shapes, cx, cy, radius, color(theme.accent), index);
    if (layout.showCompassLabels) {
        const labelRadius = Math.max(4, radius - 12);
        for (const [label, angle] of [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', Math.PI * 1.5]]) {
            addText(scene.atlas, scene.text, label, cx + Math.sin(angle) * labelRadius,
                cy - Math.cos(angle) * labelRadius - layout.typography.unit.size / 2,
                layout.typography.unit.size, color(theme.text, 0.55),
                'center', layout.typography.unit.font);
        }
    }
}

function addStatus(scene, rect, theme, index) {
    const radius = Math.max(5, Math.min(rect.width, rect.height) * 0.14);
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    shape(scene.shapes, [cx, cy, radius * 2, radius * 2], color(theme.inactive, 0.25),
        [5, radius * 1.6, 0, 0], [0, index, 6, 0]);
    shape(scene.shapes, [cx, cy, radius, radius], color(theme.inactive),
        [5, radius, 0, 0], [0, index, 6, 0]);
}

export function buildStaticScene(atlas, gauges, rectangles, header, theme, panelLayout, accents = {}) {
    const scene = { shapes: [], text: [], atlas, cellLayouts: new Map(), iconRect: null };
    const { headerRect } = panelLayout;
    if (header && headerRect.height > 0) {
        box(scene.shapes, headerRect.x, headerRect.y, headerRect.width, headerRect.height,
            color(theme.surface), 8);
        const headerContent = layoutHeader(headerRect, { hasIcon: Boolean(header.icon) });
        scene.iconRect = headerContent.iconRect;
        const badgeVisible = Boolean(header.badge) && headerRect.width > 420;
        const textWidthAvailable = badgeVisible
            ? headerContent.badgeRect.x - headerContent.title.x - 12
            : headerRect.x + headerRect.width - headerContent.title.x - 18;
        if (header.title) {
            const fitted = fitText(header.title, textWidthAvailable, {
                targetSize: headerContent.title.size,
                minSize: 11,
                measure: (text, size, font) => atlas.measure(text, size, font),
                font: 'header'
            });
            addText(atlas, scene.text, fitted.text, headerContent.title.x, headerContent.title.y,
                fitted.size, color(theme.text, 0.95), 'left', 'header');
        }
        if (header.subtitle && headerRect.width > 280) {
            const fitted = fitText(header.subtitle, textWidthAvailable, {
                targetSize: headerContent.subtitle.size,
                minSize: 9,
                measure: (text, size, font) => atlas.measure(text, size, font),
                font: 'regular'
            });
            addText(atlas, scene.text, fitted.text, headerContent.subtitle.x, headerContent.subtitle.y,
                fitted.size, color(theme.text, 0.70), 'left', 'regular');
        }
        if (badgeVisible) {
            const fitted = fitText(header.badge, headerContent.badgeRect.width - 16, {
                targetSize: 10,
                minSize: 9,
                measure: (text, size, font) => atlas.measure(text, size, font),
                font: 'label'
            });
            const badgeWidth = fitted.width + 16;
            const badgeRect = {
                ...headerContent.badgeRect,
                x: headerRect.x + headerRect.width - 18 - badgeWidth,
                width: badgeWidth
            };
            box(scene.shapes, badgeRect.x, badgeRect.y, badgeRect.width, badgeRect.height,
                color(theme.accent, 0.09), 6, 1);
            addText(atlas, scene.text, fitted.text, badgeRect.x + badgeRect.width / 2,
                badgeRect.y + 5, fitted.size, color(theme.accent), 'center', 'label');
        }
    }
    const measure = (text, size, font) => atlas.measure(text, size, font);
    gauges.forEach((gauge, index) => {
        const rect = rectangles.get(gauge.id);
        if (!rect) {
            return;
        }
        const gaugeTheme = accents[gauge.id] ? { ...theme, accent: accents[gauge.id] } : theme;
        const layout = absoluteCellLayout(rect, gauge);
        scene.cellLayouts.set(gauge.id, layout);
        box(scene.shapes, rect.x, rect.y, rect.width, rect.height, color(theme.surface), 7);
        box(scene.shapes, rect.x, rect.y, rect.width, rect.height, color(theme.grid, 0.7), 7, 1);

        const fittedLabel = fitText(gauge.label, layout.labelRect.width, {
            targetSize: layout.typography.label.size,
            minSize: layout.typography.label.minSize,
            measure,
            font: layout.typography.label.font
        });
        addText(atlas, scene.text, fittedLabel.text, layout.labelRect.x, layout.labelRect.y,
            fittedLabel.size, color(theme.text, layout.typography.label.alpha),
            'left', layout.typography.label.font);
        if (layout.showInfo) {
            const fittedInfo = fitText(gauge.info, layout.infoRect.width, {
                targetSize: layout.typography.info.size,
                minSize: layout.typography.info.minSize,
                measure,
                font: layout.typography.info.font
            });
            addText(atlas, scene.text, fittedInfo.text, layout.infoRect.x, layout.infoRect.y,
                fittedInfo.size, color(theme.text, layout.typography.info.alpha),
                'left', layout.typography.info.font);
        }

        if (gauge.type === 'arc') {
            addArcGauge(scene, gauge, layout.gaugeRect, gaugeTheme, index, layout);
        } else if (gauge.type === 'linear') {
            addLinearGauge(scene, gauge, layout.gaugeRect, gaugeTheme, index, layout);
        } else if (gauge.type === 'compass') {
            addCompass(scene, gauge, layout.gaugeRect, gaugeTheme, index, layout);
        } else {
            addStatus(scene, layout.gaugeRect, gaugeTheme, index);
        }
    });
    return scene;
}

export function formatGaugeValue(gauge) {
    if (gauge.type === 'status') {
        return resolveStatus(gauge, gauge.value).label;
    }
    const value = Number(gauge.value);
    if (gauge.type === 'compass') {
        return Math.round(value).toString().padStart(3, '0');
    }
    const rangeMagnitude = Math.max(Math.abs(gauge.min), Math.abs(gauge.max));
    return rangeMagnitude >= 100 ? value.toFixed(0) : value.toFixed(1);
}

/** A compact key for deciding whether dynamic glyph geometry or color actually changed. */
export function dynamicTextKey(gauges) {
    let key = '';
    for (const gauge of gauges) {
        const formatted = formatGaugeValue(gauge);
        if (gauge.type === 'status') {
            const status = resolveStatus(gauge, gauge.value);
            key += `${formatted.length}:${formatted}@status:${status.kind ?? 'normal'}|`;
        } else {
            const activeBand = resolveBand(gauge);
            const bandKind = activeBand ? activeBand.kind ?? 'normal' : 'text';
            key += `${formatted.length}:${formatted}@${bandKind}|`;
        }
    }
    return key;
}

/** Write the small per-gauge value/color records without allocating an intermediate array. */
export function buildDynamicValues(gauges, theme, output = [], accents = {}) {
    const length = Math.max(8, gauges.length * 8);
    if (Array.isArray(output)) {
        output.length = length;
    } else if (output.length < length) {
        throw new RangeError('Dynamic value output is smaller than required.');
    }
    let offset = 0;
    for (const gauge of gauges) {
        const accent = color(accents[gauge.id] ?? theme.accent);
        const normalized = gauge.type === 'status' ? 0 : normalizeValue(gauge, gauge.value);
        const status = gauge.type === 'status' ? resolveStatus(gauge, gauge.value) : null;
        const rgba = status
            ? semanticColor(theme, status.kind, status.kind === 'inactive' ? 'inactive' : 'normal')
            : accent;
        output[offset] = normalized;
        output[offset + 1] = Number(gauge.value) || 0;
        output[offset + 2] = 0;
        output[offset + 3] = 0;
        output[offset + 4] = rgba[0];
        output[offset + 5] = rgba[1];
        output[offset + 6] = rgba[2];
        output[offset + 7] = rgba[3];
        offset += 8;
    }
    if (gauges.length === 0) {
        output[0] = 0;
        output[1] = 0;
        output[2] = 0;
        output[3] = 0;
        output[4] = 1;
        output[5] = 1;
        output[6] = 1;
        output[7] = 1;
    }
    return output;
}

/** Rebuild glyph instances only when the formatted readout or semantic color changes. */
export function buildDynamicText(atlas, gauges, cellLayouts, theme, output = []) {
    output.length = 0;
    const measure = (value, size, font) => atlas.measure(value, size, font);
    gauges.forEach((gauge) => {
        const status = gauge.type === 'status' ? resolveStatus(gauge, gauge.value) : null;
        const activeBand = gauge.type === 'status' ? null : resolveBand(gauge);
        const valueColor = activeBand
            ? semanticColor(theme, activeBand.kind, 'normal')
            : color(theme.text);
        const layout = cellLayouts.get(gauge.id);
        if (!layout) {
            return;
        }
        const formatted = formatGaugeValue(gauge);
        const stacked = layout.readoutMode.endsWith('-stacked');
        const unit = layout.showUnit && gauge.unit
            ? fitText(gauge.unit, stacked ? layout.readoutRect.width : layout.readoutRect.width * 0.34, {
                targetSize: layout.typography.unit.size,
                minSize: layout.typography.unit.minSize,
                measure,
                font: layout.typography.unit.font
            })
            : null;
        const unitWidth = !stacked && unit ? unit.width + 6 : 0;
        const fitted = fitText(formatted, layout.readoutRect.width - unitWidth, {
            targetSize: layout.typography.value.size,
            minSize: layout.typography.value.minSize,
            measure,
            font: layout.typography.value.font
        });
        const readoutColor = status
            ? semanticColor(theme, status.kind, status.kind === 'inactive' ? 'inactive' : 'normal')
            : valueColor;
        const valueWidth = textWidth(atlas, fitted.text, fitted.size, layout.typography.value.font);
        const valueMetrics = atlas.metrics(fitted.size, layout.typography.value.font);
        if (stacked) {
            const unitMetrics = unit
                ? atlas.metrics(unit.size, layout.typography.unit.font)
                : { ascent: 0, descent: 0, lineHeight: 0 };
            const gap = unit ? 4 : 0;
            const totalHeight = valueMetrics.lineHeight + gap + unitMetrics.lineHeight;
            const top = layout.readoutRect.y + (layout.readoutRect.height - totalHeight) / 2;
            addText(atlas, output, fitted.text,
                layout.readoutRect.x + layout.readoutRect.width / 2,
                top + valueMetrics.ascent, fitted.size, readoutColor,
                'center', layout.typography.value.font, 'baseline');
            if (unit) {
                addText(atlas, output, unit.text,
                    layout.readoutRect.x + layout.readoutRect.width / 2,
                    top + valueMetrics.lineHeight + gap + unitMetrics.ascent,
                    unit.size, color(theme.text, layout.typography.unit.alpha),
                    'center', layout.typography.unit.font, 'baseline');
            }
        } else {
            const groupX = layout.readoutRect.x
                + (layout.readoutRect.width - valueWidth - unitWidth) / 2;
            const unitMetrics = unit
                ? atlas.metrics(unit.size, layout.typography.unit.font)
                : { ascent: 0, descent: 0 };
            const ascent = Math.max(valueMetrics.ascent, unitMetrics.ascent);
            const descent = Math.max(valueMetrics.descent, unitMetrics.descent);
            const baseline = layout.readoutRect.y
                + (layout.readoutRect.height - ascent - descent) / 2 + ascent;
            addText(atlas, output, fitted.text, groupX, baseline, fitted.size, readoutColor,
                'left', layout.typography.value.font, 'baseline');
            if (unit) {
                addText(atlas, output, unit.text, groupX + valueWidth + 6, baseline,
                    unit.size, color(theme.text, layout.typography.unit.alpha),
                    'left', layout.typography.unit.font, 'baseline');
            }
        }
    });
    return output;
}

export function buildDynamicData(atlas, gauges, cellLayouts, theme) {
    return {
        values: buildDynamicValues(gauges, theme),
        text: buildDynamicText(atlas, gauges, cellLayouts, theme)
    };
}
