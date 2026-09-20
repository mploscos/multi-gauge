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
    sequence += 1;
    const id = sequence;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve) => pending.set(id, resolve));
}

async function evaluate(expression) {
    const response = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.result.exceptionDetails) {
        throw new Error(response.result.exceptionDetails.text);
    }
    return response.result.result.value;
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

await command('Runtime.enable');
await command('Page.enable');
await command('Page.navigate', { url: `http://127.0.0.1:${webPort}/demo/` });
await wait(3000);
const initial = await evaluate(`(() => {
    const source = document.querySelector('[data-gauge-id="temperature"]');
    const target = document.querySelector('[data-gauge-id="pressure"]');
    source.scrollIntoView({ block: 'center' });
    const a = source.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    globalThis.__editorSource = source;
    const state = globalThis.demoPanels.vehicle.serialize();
    return {
        source: { x: a.x + a.width / 2, y: a.y + a.height / 2 },
        target: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
        hit: document.elementFromPoint(a.x + a.width / 2, a.y + a.height / 2)?.dataset.gaugeId ?? document.elementFromPoint(a.x + a.width / 2, a.y + a.height / 2)?.tagName,
        temperature: state.gauges.find(gauge => gauge.id === 'temperature'),
        pressure: state.gauges.find(gauge => gauge.id === 'pressure')
    };
})()`);

await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: initial.source.x, y: initial.source.y, button: 'left', buttons: 1, clickCount: 1 });
await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (initial.source.x + initial.target.x) / 2, y: initial.source.y, button: 'left', buttons: 1 });
await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: initial.target.x, y: initial.target.y, button: 'left', buttons: 1 });
await wait(700);
const during = await evaluate(`(() => {
    const state = globalThis.demoPanels.vehicle.serialize();
    return {
        sameNode: globalThis.__editorSource === document.querySelector('[data-gauge-id="temperature"]'),
        connected: globalThis.__editorSource.isConnected,
        placeholder: getComputedStyle(document.querySelector('[data-grid-placeholder]')).display,
        committedCol: state.gauges.find(gauge => gauge.id === 'temperature').col
    };
})()`);
await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: initial.target.x, y: initial.target.y, button: 'left', buttons: 0, clickCount: 1 });
await wait(500);
const committed = await evaluate(`(() => {
    const state = globalThis.demoPanels.vehicle.serialize();
    return {
        temperature: state.gauges.find(gauge => gauge.id === 'temperature').col,
        pressure: state.gauges.find(gauge => gauge.id === 'pressure').col,
        overlays: document.querySelectorAll('[data-multigauge-editor]').length
    };
})()`);

const cancelSource = await evaluate(`(() => {
    const node = document.querySelector('[data-gauge-id="temperature"]');
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
})()`);
await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: cancelSource.x, y: cancelSource.y, button: 'left', buttons: 1, clickCount: 1 });
await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: initial.source.x, y: initial.source.y, button: 'left', buttons: 1 });
await wait(150);
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
await wait(300);
const cancelled = await evaluate(`(() => {
    const state = globalThis.demoPanels.vehicle.serialize();
    return {
        temperature: state.gauges.find(gauge => gauge.id === 'temperature').col,
        placeholder: getComputedStyle(document.querySelector('[data-grid-placeholder]')).display
    };
})()`);

console.log(JSON.stringify({ initial, during, committed, cancelled, errors }, null, 2));
socket.close();
