import { MultiGauge } from '../src/index.js';
import { benchmarkGauge, benchmarkValue } from './scenarios.js';

const stage = document.querySelector('#stage');
const fields = Object.fromEntries(['fps', 'frame', 'renders', 'updates', 'coalesced', 'draws', 'writes']
    .map((id) => [id, document.querySelector(`#${id}`)]));
let panels = [];
let timer;
let metricsTimer;
let previousRenders = 0;
let previousTime = performance.now();
function configuration(index, total) {
    const side = Math.ceil(Math.sqrt(total));
    return {
        grid: { rows: side, columns: side, gap: 3 },
        accent: index % 2 ? '#9d7bff' : '#00eaff',
        gauges: Array.from({ length: total }, (_, gaugeIndex) =>
            benchmarkGauge(index, gaugeIndex, total))
    };
}

async function start() {
    clearInterval(timer);
    clearInterval(metricsTimer);
    for (const panel of panels) {
        panel.destroy();
    }
    panels = [];
    stage.replaceChildren();
    const count = Number(document.querySelector('#count').value);
    const rate = Number(document.querySelector('#rate').value);
    const topology = document.querySelector('#topology').value;
    const panelCount = topology === 'sixteen' ? 16 : 1;
    const gaugesPerPanel = topology === 'sixteen' ? 1 : count;
    stage.style.setProperty('--panels', topology === 'sixteen' ? 4 : 1);
    for (let index = 0; index < panelCount; index += 1) {
        const canvas = document.createElement('canvas');
        stage.append(canvas);
        panels.push(await MultiGauge.create(canvas, configuration(index, gaugesPerPanel)));
    }
    globalThis.benchmarkPanels = panels;
    let tick = 0;
    timer = setInterval(() => {
        tick += 1;
        panels.forEach((panel, panelIndex) => {
            const values = {};
            for (let index = 0; index < gaugesPerPanel; index += 1) {
                values[`signal-${panelIndex}-${index}`] = benchmarkValue(
                    panelIndex,
                    index,
                    gaugesPerPanel,
                    tick,
                    rate
                );
            }
            panel.update(values);
        });
    }, 1000 / rate);
    previousRenders = 0;
    previousTime = performance.now();
    metricsTimer = setInterval(updateMetrics, 500);
}

function updateMetrics() {
    const now = performance.now();
    const stats = panels.map((panel) => panel.getStats());
    const sum = (key) => stats.reduce((total, item) => total + item[key], 0);
    const renders = sum('renders');
    const elapsed = (now - previousTime) / 1000;
    fields.fps.textContent = ((renders - previousRenders) / elapsed).toFixed(1);
    fields.frame.textContent = `${(stats.reduce((total, item) => total + item.averageFrameTime, 0) / Math.max(1, stats.length)).toFixed(2)} ms`;
    fields.renders.textContent = renders;
    fields.updates.textContent = sum('updatesReceived');
    fields.coalesced.textContent = sum('rendersCoalesced');
    fields.draws.textContent = (sum('drawCalls') / Math.max(1, renders)).toFixed(2);
    fields.writes.textContent = (sum('writeBufferCalls') / Math.max(1, renders)).toFixed(2);
    previousRenders = renders;
    previousTime = now;
}

document.querySelector('#run').addEventListener('click', () => start().catch(showError));
document.querySelector('#topology').addEventListener('change', (event) => {
    document.querySelector('#count').disabled = event.target.value === 'sixteen';
});

function showError(error) {
    document.querySelector('#error').textContent = error.message;
}

start().catch(showError);
