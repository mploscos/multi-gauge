/** An error caused by invalid MultiGauge usage or an unavailable GPU. */
export class MultiGaugeError extends Error {
    constructor(message, options) {
        super(message, options);
        this.name = 'MultiGaugeError';
    }
}
