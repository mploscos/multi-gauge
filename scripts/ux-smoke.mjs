import { writeFile } from 'node:fs/promises';

const port = process.argv[2] ?? '9225';
const webPort = process.argv[3] ?? '8080';
const pages = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
const page = pages.find((target) => target.type === 'page');
if (!page) {
    throw new Error('No Chrome page target found.');
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const errors = [];
socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
    }
    if (message.method === 'Runtime.exceptionThrown') {
        errors.push(message.params.exceptionDetails.text);
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        errors.push(message.params.args.map((argument) => argument.description ?? argument.value).join(' '));
    }
});

function command(method, params = {}) {
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => pending.set(id, resolve));
}

async function evaluate(expression) {
    const response = await command('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true
    });
    if (response.result.exceptionDetails) {
        throw new Error(response.result.exceptionDetails.exception?.description
            ?? response.result.exceptionDetails.text);
    }
    return response.result.result.value;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function navigate(url) {
    await command('Page.navigate', { url });
    await wait(2500);
}

async function mouse(type, point, buttons) {
    await command('Input.dispatchMouseEvent', {
        type,
        x: point.x,
        y: point.y,
        button: 'left',
        buttons,
        clickCount: type === 'mouseMoved' ? 0 : 1
    });
}

async function screenshot(path) {
    const response = await command('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true
    });
    await writeFile(path, Buffer.from(response.result.data, 'base64'));
}

await command('Runtime.enable');
await command('Page.enable');
await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 960,
    deviceScaleFactor: 1.5,
    mobile: false
});

await navigate(`http://127.0.0.1:${webPort}/demo/`);
const headerGeometry = await evaluate(`(() => {
    const canvas = document.querySelector('#vehicle');
    const overlay = document.querySelector('[data-multigauge-editor]');
    const first = document.querySelector('[data-gauge-id="speed"]');
    if (!canvas || !overlay || !first) {
        return {
            missing: { canvas: !canvas, overlay: !overlay, first: !first },
            error: document.querySelector('#error')?.textContent ?? '',
            body: document.body.innerText.slice(0, 500)
        };
    }
    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const firstRect = first.getBoundingClientRect();
    return {
        canvasTop: canvasRect.top,
        overlayTop: overlayRect.top,
        firstTop: firstRect.top,
        headerHit: document.elementFromPoint(canvasRect.left + 12, canvasRect.top + 30)?.dataset.multigaugeEditor ?? 'canvas',
        gapFromRegularHeader: overlayRect.top - canvasRect.top - 64,
        overlayMatchesFirst: Math.abs(overlayRect.top - firstRect.top) < 0.1,
        backingScale: canvas.width / canvas.clientWidth,
        fontFamily: getComputedStyle(canvas).fontFamily,
        packageFontRequests: performance.getEntriesByType('resource')
            .filter(({ name }) => name.endsWith('/InterVariable.woff2')).length
    };
})()`);
if (headerGeometry.missing) {
    console.log(JSON.stringify({ headerGeometry, errors }, null, 2));
    socket.close();
    process.exitCode = 1;
    await new Promise((resolve) => socket.addEventListener('close', resolve, { once: true }));
    process.exit();
}
const closeButtonVisual = await evaluate(`(() => {
    const button = document.querySelector('[data-gauge-remove]');
    const style = getComputedStyle(button);
    return {
        text: button.textContent,
        background: style.backgroundColor,
        borderTopWidth: style.borderTopWidth
    };
})()`);
if (closeButtonVisual.text !== '×'
    || closeButtonVisual.background !== 'rgba(0, 0, 0, 0)'
    || closeButtonVisual.borderTopWidth !== '0px') {
    throw new Error(`Gauge close control is not minimal: ${JSON.stringify(closeButtonVisual)}`);
}
const beforeGaugeRemoval = await evaluate(`({
    renders: globalThis.demoPanels.vehicle.getStats().renders,
    speed: globalThis.demoPanels.vehicle.serialize().gauges.find(({ id }) => id === 'speed').value
})`);
await evaluate(`globalThis.demoPanels.vehicle.remove('temperature')`);
await wait(300);
const afterGaugeRemoval = await evaluate(`({
    renders: globalThis.demoPanels.vehicle.getStats().renders,
    speed: globalThis.demoPanels.vehicle.serialize().gauges.find(({ id }) => id === 'speed').value,
    removed: !globalThis.demoPanels.vehicle.serialize().gauges.some(({ id }) => id === 'temperature'),
    error: document.querySelector('#error').textContent
})`);
if (!afterGaugeRemoval.removed
    || afterGaugeRemoval.renders <= beforeGaugeRemoval.renders
    || afterGaugeRemoval.speed === beforeGaugeRemoval.speed
    || afterGaugeRemoval.error) {
    throw new Error(`Demo stopped after removing a gauge: ${JSON.stringify({
        beforeGaugeRemoval,
        afterGaugeRemoval
    })}`);
}
await screenshot('/tmp/multigauge-demo-ux.png');
await evaluate(`document.querySelector('.primary').style.height = '600px'`);
await wait(1000);
const resizedGeometry = await evaluate(`(() => {
    const canvas = document.querySelector('#vehicle').getBoundingClientRect();
    const overlay = document.querySelector('[data-multigauge-editor]').getBoundingClientRect();
    const first = document.querySelector('[data-gauge-id="speed"]').getBoundingClientRect();
    return {
        overlayMatchesFirst: Math.abs(overlay.top - first.top) < 0.1,
        overlayInsideCanvas: overlay.top >= canvas.top - 0.1 && overlay.bottom <= canvas.bottom + 0.1,
        canvasHeight: canvas.height,
        gridHeight: overlay.height,
        bottomDelta: overlay.bottom - canvas.bottom
    };
})()`);

await evaluate(`(async () => {
    const { MultiGauge } = await import('/src/index.js');
    const host = document.createElement('section');
    host.id = 'no-header-fixture';
    Object.assign(host.style, {
        position: 'relative', width: '540px', height: '360px', marginTop: '20px',
        transform: 'scale(.8)', transformOrigin: 'top left'
    });
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, {
        display: 'block', width: '100%', height: '100%', border: '3px solid transparent', padding: '5px'
    });
    host.append(canvas);
    document.body.append(host);
    globalThis.__uxPanel = await MultiGauge.create(canvas, {
        grid: { rows: 3, columns: 3, gap: 8 },
        gauges: [
            { id: 'first', type: 'arc', label: 'SPEED', row: 0, col: 0 },
            { id: 'middle', type: 'linear', label: 'ENGINE TEMPERATURE', row: 0, col: 1 },
            { id: 'extra', type: 'status', label: 'SYSTEM', row: 0, col: 2 },
            { id: 'last', type: 'arc', label: 'MAIN BATTERY VOLTAGE', row: 2, col: 2 }
        ]
    });
    await new Promise(requestAnimationFrame);
})()`);

const noHeaderBefore = await evaluate(`(() => {
    const host = document.querySelector('#no-header-fixture');
    host.scrollIntoView({ block: 'center' });
    const canvas = host.querySelector('canvas');
    const overlay = host.querySelector('[data-multigauge-editor]');
    const first = host.querySelector('[data-gauge-id="first"]').getBoundingClientRect();
    const last = host.querySelector('[data-gauge-id="last"]').getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    return {
        canvasContentTop: canvasRect.top + (canvas.clientTop + 5) * .8,
        overlayTop: overlayRect.top,
        first: { x: first.x + first.width / 2, y: first.y + first.height / 2 },
        last: { x: last.x + last.width / 2, y: last.y + last.height / 2 }
    };
})()`);

await mouse('mousePressed', noHeaderBefore.first, 1);
await mouse('mouseMoved', noHeaderBefore.last, 1);
await mouse('mouseReleased', noHeaderBefore.last, 0);
await wait(300);
const afterEdgeDrag = await evaluate(`(() => {
    const gauges = globalThis.__uxPanel.serialize().gauges;
    return Object.fromEntries(gauges.map(({ id, row, col }) => [id, { row, col }]));
})()`);

const resizePoints = await evaluate(`(() => {
    const node = document.querySelector('#no-header-fixture [data-gauge-id="last"]');
    const rect = node.getBoundingClientRect();
    return {
        start: { x: rect.right - 3, y: rect.top + rect.height / 2 },
        end: { x: rect.right + rect.width, y: rect.top + rect.height / 2 }
    };
})()`);
await mouse('mousePressed', resizePoints.start, 1);
await mouse('mouseMoved', resizePoints.end, 1);
await mouse('mouseReleased', resizePoints.end, 0);
await wait(300);
const afterResize = await evaluate(`(() => {
    const gauge = globalThis.__uxPanel.serialize().gauges.find(({ id }) => id === 'last');
    globalThis.__uxPanel.maximize('last');
    const maximized = globalThis.__uxPanel.serialize().gauges.find(({ id }) => id === 'last');
    globalThis.__uxPanel.restoreGauge('last');
    const restored = globalThis.__uxPanel.serialize().gauges.find(({ id }) => id === 'last');
    return {
        resized: { rowSpan: gauge.rowSpan, colSpan: gauge.colSpan },
        maximized: { rowSpan: maximized.rowSpan, colSpan: maximized.colSpan },
        restored: { row: restored.row, col: restored.col, rowSpan: restored.rowSpan, colSpan: restored.colSpan }
    };
})()`);

await navigate(`http://127.0.0.1:${webPort}/benchmark/`);
await evaluate(`document.querySelector('#count').value = '64'; document.querySelector('#run').click()`);
await wait(2500);
const dense64 = await evaluate(`({
    error: document.querySelector('#error').textContent,
    renders: document.querySelector('#renders').textContent,
    frame: document.querySelector('#frame').textContent,
    draws: document.querySelector('#draws').textContent,
    writes: document.querySelector('#writes').textContent
})`);
await screenshot('/tmp/multigauge-8x8.png');
await evaluate(`document.querySelector('#count').value = '100'; document.querySelector('#run').click()`);
await wait(2500);
const dense100 = await evaluate(`({
    error: document.querySelector('#error').textContent,
    renders: document.querySelector('#renders').textContent,
    frame: document.querySelector('#frame').textContent,
    draws: document.querySelector('#draws').textContent,
    writes: document.querySelector('#writes').textContent
})`);
await screenshot('/tmp/multigauge-10x10.png');

console.log(JSON.stringify({
    headerGeometry,
    closeButtonVisual,
    removalContinuity: { beforeGaugeRemoval, afterGaugeRemoval },
    resizedGeometry,
    noHeader: {
        aligned: Math.abs(noHeaderBefore.canvasContentTop - noHeaderBefore.overlayTop) < 0.1,
        ...noHeaderBefore
    },
    afterEdgeDrag,
    afterResize,
    dense64,
    dense100,
    screenshots: [
        '/tmp/multigauge-demo-ux.png',
        '/tmp/multigauge-8x8.png',
        '/tmp/multigauge-10x10.png'
    ],
    errors
}, null, 2));
socket.close();
