/** URL-keyed icon textures shared across all panels on the device. */
export class IconCache {
    #device;
    #entries = new Map();

    constructor(device) {
        this.#device = device;
    }

    async acquire(input) {
        if (!input) {
            return null;
        }
        const url = input instanceof URL ? input.href : new URL(String(input), document.baseURI).href;
        let entry = this.#entries.get(url);
        if (!entry) {
            entry = { refs: 0, promise: this.#load(url) };
            this.#entries.set(url, entry);
        }
        entry.refs += 1;
        return entry.promise;
    }

    release(input) {
        if (!input) {
            return;
        }
        const url = input instanceof URL ? input.href : new URL(String(input), document.baseURI).href;
        const entry = this.#entries.get(url);
        if (!entry) {
            return;
        }
        entry.refs -= 1;
        if (entry.refs <= 0) {
            entry.promise.then((icon) => icon.texture.destroy()).catch(() => {});
            this.#entries.delete(url);
        }
    }

    destroy() {
        for (const entry of this.#entries.values()) {
            entry.promise.then((icon) => icon.texture.destroy()).catch(() => {});
        }
        this.#entries.clear();
    }

    async #load(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Unable to load icon: ${url}`);
        }
        const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'premultiply' });
        const width = bitmap.width;
        const height = bitmap.height;
        const texture = this.#device.createTexture({
            label: `MultiGauge icon ${url}`,
            size: [bitmap.width, bitmap.height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
        });
        this.#device.queue.copyExternalImageToTexture(
            { source: bitmap },
            { texture },
            [bitmap.width, bitmap.height]
        );
        bitmap.close();
        return { url, texture, view: texture.createView(), width, height };
    }
}
