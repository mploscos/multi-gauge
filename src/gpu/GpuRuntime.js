import { MultiGaugeError } from '../errors.js';
import { IconCache } from './IconCache.js';
import { SHAPE_SHADER, TEXTURE_SHADER } from './shaders.js';
import { TextAtlas } from './TextAtlas.js';

/** One WebGPU device and one set of immutable pipelines for the page. */
export class SharedGpuRuntime {
    static #promise;
    #adapter;
    #device;
    #format;
    #shapeLayout;
    #textureLayout;
    #shapePipeline;
    #texturePipeline;
    #atlas;
    #icons;
    #clients = new Set();
    #generation = 0;
    #recovering = false;

    static get(options = {}) {
        if (!this.#promise) {
            const runtime = new SharedGpuRuntime(options);
            this.#promise = runtime.#initialize().then(() => runtime);
        }
        return this.#promise;
    }

    constructor(options = {}) {
        this.#fontFamily = options.fontFamily;
    }

    get device() {
        return this.#device;
    }

    get format() {
        return this.#format;
    }

    get shapeLayout() {
        return this.#shapeLayout;
    }

    get textureLayout() {
        return this.#textureLayout;
    }

    get shapePipeline() {
        return this.#shapePipeline;
    }

    get texturePipeline() {
        return this.#texturePipeline;
    }

    get atlas() {
        return this.#atlas;
    }

    get icons() {
        return this.#icons;
    }

    get generation() {
        return this.#generation;
    }

    register(client) {
        this.#clients.add(client);
    }

    unregister(client) {
        this.#clients.delete(client);
    }

    async #initialize() {
        if (!globalThis.navigator?.gpu) {
            throw new MultiGaugeError('WebGPU is not available in this browser.');
        }
        this.#adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!this.#adapter) {
            throw new MultiGaugeError('WebGPU is available, but no suitable GPU adapter was found.');
        }
        this.#device = await this.#adapter.requestDevice();
        this.#format = navigator.gpu.getPreferredCanvasFormat();
        this.#createSharedResources();
        this.#atlas = new TextAtlas(
            this.#device,
            globalThis.devicePixelRatio || 1,
            this.#fontFamily
        );
        await this.#atlas.initialize();
        this.#icons = new IconCache(this.#device);
        this.#generation += 1;
        const observedDevice = this.#device;
        observedDevice.lost.then((info) => this.#handleLoss(observedDevice, info));
    }

    #createSharedResources() {
        this.#shapeLayout = this.#device.createBindGroupLayout({
            label: 'MultiGauge shape bindings',
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
                { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }
            ]
        });
        this.#textureLayout = this.#device.createBindGroupLayout({
            label: 'MultiGauge texture bindings',
            entries: [
                { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
                { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
                { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
                { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }
            ]
        });
        const blend = {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }
        };
        const shapeModule = this.#device.createShaderModule({ label: 'MultiGauge shapes', code: SHAPE_SHADER });
        this.#shapePipeline = this.#device.createRenderPipeline({
            label: 'MultiGauge shape pipeline',
            layout: this.#device.createPipelineLayout({ bindGroupLayouts: [this.#shapeLayout] }),
            vertex: { module: shapeModule, entryPoint: 'vertexMain' },
            fragment: { module: shapeModule, entryPoint: 'fragmentMain', targets: [{ format: this.#format, blend }] },
            primitive: { topology: 'triangle-list' }
        });
        const textureModule = this.#device.createShaderModule({ label: 'MultiGauge textures', code: TEXTURE_SHADER });
        this.#texturePipeline = this.#device.createRenderPipeline({
            label: 'MultiGauge texture pipeline',
            layout: this.#device.createPipelineLayout({ bindGroupLayouts: [this.#textureLayout] }),
            vertex: { module: textureModule, entryPoint: 'vertexMain' },
            fragment: { module: textureModule, entryPoint: 'fragmentMain', targets: [{ format: this.#format, blend }] },
            primitive: { topology: 'triangle-list' }
        });
    }

    async #handleLoss(device, info) {
        if (device !== this.#device || info.reason === 'destroyed' || this.#recovering) {
            return;
        }
        this.#recovering = true;
        try {
            this.#atlas?.destroy();
            this.#icons?.destroy();
            await this.#initialize();
            for (const client of this.#clients) {
                client.onRuntimeRestored();
            }
        } catch (error) {
            for (const client of this.#clients) {
                client.onRuntimeError(error);
            }
        } finally {
            this.#recovering = false;
        }
    }

    #fontFamily;
}
