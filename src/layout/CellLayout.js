function bucket(width, height) {
    if (width < 180 || height < 150) {
        return 'small';
    }
    if (width < 300 || height < 230) {
        return 'medium';
    }
    return 'large';
}

/**
 * Fit one unwrapped line using a caller-provided real metrics function.
 * Returns the chosen text and size without mutating or changing its case.
 */
export function fitText(text, maxWidth, options) {
    const value = String(text ?? '');
    const measure = options?.measure;
    if (typeof measure !== 'function') {
        throw new TypeError('fitText() requires a measure(text, size, font) function.');
    }
    const targetSize = Math.max(1, Number(options.targetSize) || 11);
    const minSize = Math.min(targetSize, Math.max(1, Number(options.minSize) || 9));
    const step = Math.max(0.25, Number(options.step) || 0.5);
    const font = options.font ?? 'regular';
    const ellipsis = options.ellipsis ?? '…';
    const available = Math.max(0, Number(maxWidth) || 0);

    for (let size = targetSize; size >= minSize; size -= step) {
        const width = measure(value, size, font);
        if (width <= available) {
            return { text: value, size, width, truncated: false, font };
        }
    }

    const ellipsisWidth = measure(ellipsis, minSize, font);
    if (ellipsisWidth > available) {
        return { text: '', size: minSize, width: 0, truncated: value.length > 0, font };
    }
    let fitted = '';
    for (const character of value) {
        const candidate = `${fitted}${character}${ellipsis}`;
        if (measure(candidate, minSize, font) > available) {
            break;
        }
        fitted += character;
    }
    const result = fitted.length < value.length ? `${fitted}${ellipsis}` : fitted;
    return {
        text: result,
        size: minSize,
        width: measure(result, minSize, font),
        truncated: result !== value,
        font
    };
}

/** Return the common meta/gauge/readout composition for one gauge cell. */
export function layoutCell({
    width,
    height,
    gaugeType = 'arc',
    orientation = 'horizontal',
    hasInfo = false,
    hasUnit = false,
    hasMarkers = false,
    hasMarkerLabels = false,
    hasBandLabels = false
} = {}) {
    const cellWidth = Math.max(1, Number(width) || 1);
    const cellHeight = Math.max(1, Number(height) || 1);
    const level = bucket(cellWidth, cellHeight);
    const sizes = {
        small: { padding: 8, label: 10, minLabel: 8.5, info: 9, value: 17, unit: 11, readout: 25 },
        medium: { padding: 11, label: 11, minLabel: 9, info: 10, value: 23, unit: 12, readout: 32 },
        large: { padding: 13, label: 12, minLabel: 9, info: 11, value: 29, unit: 13, readout: 39 }
    }[level];
    const showInfo = hasInfo && level !== 'small';
    const showUnit = hasUnit && cellWidth >= 72 && cellHeight >= 82;
    const labelLineHeight = sizes.label + 4;
    const infoLineHeight = showInfo ? sizes.info + 3 : 0;
    const metaHeight = labelLineHeight + (showInfo ? infoLineHeight + 1 : 0);
    const innerWidth = Math.max(1, cellWidth - sizes.padding * 2);
    const metaY = sizes.padding;
    const gaugeY = metaY + metaHeight + 3;
    const availableAfterMeta = Math.max(1, cellHeight - sizes.padding - gaugeY);
    const valueSize = gaugeType === 'status' ? Math.min(sizes.value, 23) : sizes.value;
    const centeredReadout = gaugeType === 'arc' || gaugeType === 'compass';
    const sideReadout = gaugeType === 'linear' && orientation === 'vertical';
    const footerReadoutHeight = Math.min(sizes.readout, Math.max(1, availableAfterMeta * 0.48));
    const footerReadoutY = Math.max(gaugeY + 1, cellHeight - sizes.padding - footerReadoutHeight);
    const gaugeHeight = centeredReadout || sideReadout
        ? availableAfterMeta
        : Math.max(1, footerReadoutY - gaugeY - 3);
    const stackedReadoutHeight = Math.min(
        gaugeHeight * 0.62,
        valueSize + (showUnit ? sizes.unit + 6 : 2)
    );
    const sideReadoutHeight = Math.min(
        gaugeHeight * 0.5,
        Math.max(valueSize, showUnit ? sizes.unit : 0) + 4
    );
    const readoutHeight = centeredReadout
        ? stackedReadoutHeight
        : sideReadout ? sideReadoutHeight : footerReadoutHeight;
    const readoutY = centeredReadout || sideReadout
        ? gaugeY + (gaugeHeight - readoutHeight) / 2
        : footerReadoutY;
    const sideGap = sideReadout ? 4 : 0;
    const sideGaugeRatio = hasBandLabels ? 0.56 : 0.44;
    const sideGaugeWidth = sideReadout
        ? Math.max(24, Math.min(innerWidth * sideGaugeRatio, innerWidth - sideGap - 1))
        : innerWidth;
    const readoutX = sideReadout ? sizes.padding + sideGaugeWidth + sideGap : sizes.padding;
    const readoutWidth = sideReadout
        ? Math.max(1, innerWidth - sideGaugeWidth - sideGap)
        : innerWidth;

    const labelRect = { x: sizes.padding, y: metaY, width: innerWidth, height: labelLineHeight };
    const infoRect = {
        x: sizes.padding,
        y: metaY + labelLineHeight + 1,
        width: innerWidth,
        height: infoLineHeight
    };

    return {
        level,
        padding: sizes.padding,
        metaRect: {
            x: sizes.padding,
            y: metaY,
            width: innerWidth,
            height: metaHeight
        },
        labelRect,
        infoRect,
        gaugeRect: {
            x: sizes.padding,
            y: gaugeY,
            width: sideGaugeWidth,
            height: gaugeHeight
        },
        readoutRect: {
            x: readoutX,
            y: readoutY,
            width: readoutWidth,
            height: readoutHeight
        },
        readoutMode: centeredReadout
            ? 'center-stacked'
            : sideReadout ? 'side-inline' : 'footer-inline',
        typography: {
            label: { size: sizes.label, minSize: sizes.minLabel, font: 'label', alpha: 0.95 },
            info: { size: sizes.info, minSize: 8.5, font: 'regular', alpha: 0.70 },
            value: { size: valueSize, minSize: gaugeType === 'status' ? 12 : 15, font: 'value', alpha: 1 },
            unit: { size: sizes.unit, minSize: 9, font: 'unit', alpha: 0.75 },
            ticks: { alpha: 0.52 }
        },
        showInfo,
        showUnit,
        showImportantMarker: hasMarkers,
        showTicks: level !== 'small',
        showBandLabels: hasBandLabels && gaugeType !== 'status',
        showMarkerLabels: hasMarkerLabels,
        showCompassLabels: level !== 'small'
    };
}
