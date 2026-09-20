const port = process.argv[2] ?? '9225';
const url = process.argv[3];
const workload = process.argv[4];
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

await command('Runtime.enable');
await command('Page.enable');
if (url) {
    await command('Page.navigate', { url });
} else {
    await command('Page.reload', { ignoreCache: true });
}
await new Promise((resolve) => setTimeout(resolve, 4000));
if (workload) {
    await command('Runtime.evaluate', {
        expression: workload === 'sixteen-canvases'
            ? `document.querySelector('#topology').value = 'sixteen'; document.querySelector('#run').click()`
            : `document.querySelector('#count').value = '${Number(workload)}'; document.querySelector('#run').click()`
    });
    await new Promise((resolve) => setTimeout(resolve, 4000));
}
const result = await command('Runtime.evaluate', {
    expression: `({
        title: document.title,
        gpu: Boolean(navigator.gpu),
        error: document.querySelector('#error')?.textContent,
        vehicleRenders: document.querySelector('#vehicle-renders')?.textContent,
        powerRenders: document.querySelector('#power-renders')?.textContent,
        benchmarkRenders: document.querySelector('#renders')?.textContent,
        benchmarkFrame: document.querySelector('#frame')?.textContent,
        benchmarkDraws: document.querySelector('#draws')?.textContent,
        benchmarkWrites: document.querySelector('#writes')?.textContent,
        canvases: document.querySelectorAll('canvas').length,
        canvas: [document.querySelector('canvas')?.width, document.querySelector('canvas')?.height]
    })`,
    returnByValue: true
});
console.log(JSON.stringify({ page: result.result.result.value, errors }, null, 2));
socket.close();
