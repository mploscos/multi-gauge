import {
    buildDynamicText,
    buildDynamicValues,
    buildStaticScene,
    dynamicTextKey,
    TEXT_INSTANCE_SIZE
} from './SceneBuilder.js';
import { color } from '../theme.js';

const STORAGE = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;

/** Canvas-specific resources and command encoding. Pipelines live in SharedGpuRuntime. */
export class Renderer {
    #canvas;
    #context;
    #runtime;
    #invalidate;
    #buffers = Object.create(null);
    #capacities = Object.create(null);
    #shapeBindGroup;
    #staticTextBindGroup;
    #dynamicTextBindGroup;
    #iconBindGroup;
    #shapeCount = 0;
    #staticTextCount = 0;
    #dynamicTextCount = 0;
    #dynamicValuesStaging = new Float32Array(8);
    #dynamicTextStaging = new Float32Array(16);
    #dynamicTextScratch = [];
    #dynamicTextKey;
    #width = 1;
    #height = 1;
    #pixelRatio = 1;
    #iconUrl;
    #icon;
    #iconRect;
    #iconTheme;
    #iconLoading = false;
    #iconRequest = 0;
    #cellLayouts = new Map();
    #destroyed = false;
    #stats = {
        renders: 0,
        writeBufferCalls: 0,
        drawCalls: 0,
        lastFrameTime: 0,
        averageFrameTime: 0
    };

    constructor(canvas, runtime, invalidate) {
        this.#canvas = canvas;
        this.#runtime = runtime;
        this.#invalidate = invalidate;
        this.#context = canvas.getContext('webgpu');
        if (!this.#context) {
            throw new Error('Unable to create a WebGPU canvas context.');
        }
        this.#runtime.register(this);
        this.#configure();
        this.#createBuffers();
    }

    get stats() {
        return { ...this.#stats };
    }

    resize(width, height, pixelRatio = globalThis.devicePixelRatio || 1) {
        const nextWidth = Math.max(1, width);
        const nextHeight = Math.max(1, height);
        const nextRatio = Math.max(1, pixelRatio);
        const changed = nextWidth !== this.#width || nextHeight !== this.#height || nextRatio !== this.#pixelRatio;
        this.#width = nextWidth;
        this.#height = nextHeight;
        this.#pixelRatio = nextRatio;
        const physicalWidth = Math.max(1, Math.round(nextWidth * nextRatio));
        const physicalHeight = Math.max(1, Math.round(nextHeight * nextRatio));
        if (this.#canvas.width !== physicalWidth || this.#canvas.height !== physicalHeight) {
            this.#canvas.width = physicalWidth;
            this.#canvas.height = physicalHeight;
        }
        this.#write('uniform', new Float32Array([nextWidth, nextHeight, 0, 0]));
        return changed;
    }

    rebuildStatic(gauges, rectangles, header, theme, panelLayout, accents = {}) {
        const scene = buildStaticScene(
            this.#runtime.atlas,
            gauges,
            rectangles,
            header,
            theme,
            panelLayout,
            accents
        );
        this.#shapeCount = scene.shapes.length / 20;
        this.#staticTextCount = scene.text.length / TEXT_INSTANCE_SIZE;
        this.#cellLayouts = scene.cellLayouts;
        this.#dynamicTextKey = undefined;
        const shapeChanged = this.#ensure('shape', scene.shapes.length * 4, STORAGE());
        const textChanged = this.#ensure('staticText', scene.text.length * 4, STORAGE());
        this.#write('shape', new Float32Array(scene.shapes));
        this.#write('staticText', new Float32Array(scene.text));
        if (shapeChanged || textChanged || !this.#shapeBindGroup) {
            this.#createBindGroups();
        }
        this.#setIcon(header?.icon, theme, scene.iconRect);
    }

    updateDynamic(gauges, theme, accents = {}) {
        const valueLength = Math.max(8, gauges.length * 8);
        if (this.#dynamicValuesStaging.length !== valueLength) {
            this.#dynamicValuesStaging = new Float32Array(valueLength);
        }
        buildDynamicValues(gauges, theme, this.#dynamicValuesStaging, accents);
        const dynamicChanged = this.#ensure('dynamic', valueLength * 4, STORAGE());
        this.#write('dynamic', this.#dynamicValuesStaging);

        const nextTextKey = dynamicTextKey(gauges);
        let textChanged = false;
        if (nextTextKey !== this.#dynamicTextKey) {
            buildDynamicText(
                this.#runtime.atlas,
                gauges,
                this.#cellLayouts,
                theme,
                this.#dynamicTextScratch
            );
            const textLength = this.#dynamicTextScratch.length;
            this.#dynamicTextCount = textLength / TEXT_INSTANCE_SIZE;
            if (this.#dynamicTextStaging.length < textLength) {
                let capacity = this.#dynamicTextStaging.length;
                while (capacity < textLength) {
                    capacity *= 2;
                }
                this.#dynamicTextStaging = new Float32Array(capacity);
            }
            for (let index = 0; index < textLength; index += 1) {
                this.#dynamicTextStaging[index] = this.#dynamicTextScratch[index];
            }
            textChanged = this.#ensure('dynamicText', textLength * 4, STORAGE());
            this.#write('dynamicText', this.#dynamicTextStaging, textLength * 4);
            this.#dynamicTextKey = nextTextKey;
        }
        if (dynamicChanged || textChanged || !this.#dynamicTextBindGroup) {
            this.#createBindGroups();
        }
    }

    render(theme) {
        if (this.#destroyed) {
            return;
        }
        const started = performance.now();
        const device = this.#runtime.device;
        const encoder = device.createCommandEncoder({ label: 'MultiGauge frame' });
        const background = color(theme.background);
        const pass = encoder.beginRenderPass({
            label: 'MultiGauge canvas pass',
            colorAttachments: [{
                view: this.#context.getCurrentTexture().createView(),
                clearValue: { r: background[0], g: background[1], b: background[2], a: background[3] },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });
        let draws = 0;
        if (this.#shapeCount > 0) {
            pass.setPipeline(this.#runtime.shapePipeline);
            pass.setBindGroup(0, this.#shapeBindGroup);
            pass.draw(6, this.#shapeCount);
            draws += 1;
        }
        pass.setPipeline(this.#runtime.texturePipeline);
        if (this.#staticTextCount > 0) {
            pass.setBindGroup(0, this.#staticTextBindGroup);
            pass.draw(6, this.#staticTextCount);
            draws += 1;
        }
        if (this.#dynamicTextCount > 0) {
            pass.setBindGroup(0, this.#dynamicTextBindGroup);
            pass.draw(6, this.#dynamicTextCount);
            draws += 1;
        }
        if (this.#iconBindGroup) {
            pass.setBindGroup(0, this.#iconBindGroup);
            pass.draw(6, 1);
            draws += 1;
        }
        pass.end();
        device.queue.submit([encoder.finish()]);
        const frameTime = performance.now() - started;
        this.#stats.renders += 1;
        this.#stats.drawCalls += draws;
        this.#stats.lastFrameTime = frameTime;
        this.#stats.averageFrameTime += (frameTime - this.#stats.averageFrameTime) / this.#stats.renders;
    }

    onRuntimeRestored() {
        if (this.#destroyed) {
            return;
        }
        for (const key of Object.keys(this.#buffers)) {
            this.#buffers[key] = null;
            this.#capacities[key] = 0;
        }
        this.#shapeBindGroup = null;
        this.#staticTextBindGroup = null;
        this.#dynamicTextBindGroup = null;
        this.#dynamicTextKey = undefined;
        this.#iconBindGroup = null;
        this.#icon = null;
        this.#iconLoading = false;
        this.#configure();
        this.#createBuffers();
        this.#invalidate(true);
    }

    onRuntimeError(error) {
        console.error('MultiGauge could not recover its WebGPU device.', error);
    }

    destroy() {
        if (this.#destroyed) {
            return;
        }
        this.#destroyed = true;
        this.#runtime.unregister(this);
        this.#runtime.icons.release(this.#iconUrl);
        for (const buffer of Object.values(this.#buffers)) {
            buffer?.destroy();
        }
        this.#context.unconfigure();
    }

    #configure() {
        this.#context.configure({
            device: this.#runtime.device,
            format: this.#runtime.format,
            alphaMode: 'premultiplied'
        });
    }

    #createBuffers() {
        this.#ensure('shape', 16, STORAGE());
        this.#ensure('dynamic', 32, STORAGE());
        this.#ensure('staticText', 16, STORAGE());
        this.#ensure('dynamicText', 16, STORAGE());
        this.#ensure('uniform', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
        this.#ensure('icon', TEXT_INSTANCE_SIZE * 4, STORAGE());
        this.#createBindGroups();
    }

    #ensure(name, byteLength, usage) {
        const required = Math.max(16, Math.ceil(byteLength / 16) * 16);
        if (this.#buffers[name] && this.#capacities[name] >= required) {
            return false;
        }
        this.#buffers[name]?.destroy();
        let capacity = 16;
        while (capacity < required) {
            capacity *= 2;
        }
        this.#buffers[name] = this.#runtime.device.createBuffer({
            label: `MultiGauge ${name}`,
            size: capacity,
            usage
        });
        this.#capacities[name] = capacity;
        return true;
    }

    #write(name, data, byteLength = data.byteLength) {
        if (byteLength === 0) {
            return;
        }
        const source = ArrayBuffer.isView(data) ? data.buffer : data;
        const sourceOffset = ArrayBuffer.isView(data) ? data.byteOffset : 0;
        this.#runtime.device.queue.writeBuffer(
            this.#buffers[name],
            0,
            source,
            sourceOffset,
            byteLength
        );
        this.#stats.writeBufferCalls += 1;
    }

    #createBindGroups() {
        const device = this.#runtime.device;
        this.#shapeBindGroup = device.createBindGroup({
            layout: this.#runtime.shapeLayout,
            entries: [
                { binding: 0, resource: { buffer: this.#buffers.shape } },
                { binding: 1, resource: { buffer: this.#buffers.dynamic } },
                { binding: 2, resource: { buffer: this.#buffers.uniform } }
            ]
        });
        this.#staticTextBindGroup = this.#textBindGroup(this.#buffers.staticText, this.#runtime.atlas.view);
        this.#dynamicTextBindGroup = this.#textBindGroup(this.#buffers.dynamicText, this.#runtime.atlas.view);
        if (this.#icon) {
            this.#iconBindGroup = this.#textBindGroup(this.#buffers.icon, this.#icon.view);
        }
    }

    #textBindGroup(buffer, view) {
        return this.#runtime.device.createBindGroup({
            layout: this.#runtime.textureLayout,
            entries: [
                { binding: 0, resource: { buffer } },
                { binding: 1, resource: { buffer: this.#buffers.uniform } },
                { binding: 2, resource: view },
                { binding: 3, resource: this.#runtime.atlas.sampler }
            ]
        });
    }

    #setIcon(url, theme, rect) {
        this.#iconRect = rect;
        this.#iconTheme = theme;
        if (url === this.#iconUrl) {
            if (this.#icon) {
                this.#writeIcon(rect, theme);
            }
            if (this.#icon || this.#iconLoading || !url) {
                return;
            }
        } else {
            this.#runtime.icons.release(this.#iconUrl);
            this.#iconUrl = url;
            this.#icon = null;
            this.#iconBindGroup = null;
        }
        const request = ++this.#iconRequest;
        if (!url) {
            return;
        }
        this.#iconLoading = true;
        this.#runtime.icons.acquire(url).then((icon) => {
            if (this.#destroyed || request !== this.#iconRequest) {
                this.#runtime.icons.release(url);
                return;
            }
            this.#iconLoading = false;
            this.#icon = icon;
            this.#writeIcon(this.#iconRect, this.#iconTheme);
            this.#iconBindGroup = this.#textBindGroup(this.#buffers.icon, icon.view);
            this.#invalidate(false);
        }).catch((error) => {
            if (request === this.#iconRequest) {
                this.#iconLoading = false;
            }
            console.warn(error.message);
        });
    }

    #writeIcon(rect, theme) {
        if (!rect) {
            return;
        }
        const rgba = color(theme.accent);
        this.#write('icon', new Float32Array([
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
            rect.width / 2,
            rect.height / 2,
            0, 0, 1, 1,
            ...rgba,
            1, 0, 0, 0
        ]));
    }
}
