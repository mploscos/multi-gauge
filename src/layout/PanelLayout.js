const HEADER_GAP = 8;

function dimension(value) {
    return Math.max(0, Number(value) || 0);
}

/**
 * Split a panel into mutually exclusive header and grid regions.
 * Every value is expressed in CSS pixels local to the canvas content box.
 */
export function layoutPanel({ width, height, hasHeader = false } = {}) {
    const panelWidth = dimension(width);
    const panelHeight = dimension(height);
    const preferredHeaderHeight = panelWidth < 300 ? 52 : 64;
    const headerHeight = hasHeader
        ? Math.min(preferredHeaderHeight, Math.max(0, panelHeight - HEADER_GAP))
        : 0;
    const gap = headerHeight > 0 ? Math.min(HEADER_GAP, panelHeight - headerHeight) : 0;
    const gridY = headerHeight + gap;

    return Object.freeze({
        panelRect: Object.freeze({ x: 0, y: 0, width: panelWidth, height: panelHeight }),
        headerRect: Object.freeze({ x: 0, y: 0, width: panelWidth, height: headerHeight }),
        gridRect: Object.freeze({
            x: 0,
            y: gridY,
            width: panelWidth,
            height: Math.max(0, panelHeight - gridY)
        }),
        gap
    });
}

/** Convert a panel-local rectangle to coordinates local to a containing rect. */
export function localRect(rect, container) {
    return {
        x: rect.x - container.x,
        y: rect.y - container.y,
        width: rect.width,
        height: rect.height
    };
}

/** Header content geometry, also in panel-local CSS pixels. */
export function layoutHeader(headerRect, { hasIcon = false } = {}) {
    const compact = headerRect.width < 300;
    const paddingX = compact ? 14 : 18;
    const paddingY = compact ? 9 : 10;
    const iconSize = hasIcon ? (compact ? 18 : 20) : 0;
    const textX = headerRect.x + paddingX + (hasIcon ? iconSize + 10 : 0);
    const badgeWidth = Math.min(110, Math.max(0, headerRect.width * 0.24));

    return {
        compact,
        iconRect: hasIcon ? {
            x: headerRect.x + paddingX,
            y: headerRect.y + (headerRect.height - iconSize) / 2,
            width: iconSize,
            height: iconSize
        } : null,
        title: { x: textX, y: headerRect.y + paddingY, size: compact ? 14 : 16 },
        subtitle: { x: textX, y: headerRect.y + paddingY + (compact ? 20 : 23), size: compact ? 10 : 11 },
        badgeRect: {
            x: headerRect.x + headerRect.width - paddingX - badgeWidth,
            y: headerRect.y + (headerRect.height - 26) / 2,
            width: badgeWidth,
            height: 26
        }
    };
}
