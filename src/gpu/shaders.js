export const SHAPE_SHADER = /* wgsl */ `
struct Viewport {
    size: vec2f,
    _padding: vec2f,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) local: vec2f,
    @location(1) @interpolate(flat) instance: u32,
}

@group(0) @binding(0) var<storage, read> shapes: array<vec4f>;
@group(0) @binding(1) var<storage, read> dynamics: array<vec4f>;
@group(0) @binding(2) var<uniform> viewport: Viewport;

@vertex
fn vertexMain(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> VertexOutput {
    let corners = array<vec2f, 6>(
        vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
        vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
    );
    let geometry = shapes[instance * 5u];
    let local = corners[vertex];
    let pixel = geometry.xy + local * geometry.zw;
    var output: VertexOutput;
    output.position = vec4f(pixel.x / viewport.size.x * 2.0 - 1.0, 1.0 - pixel.y / viewport.size.y * 2.0, 0.0, 1.0);
    output.local = local;
    output.instance = instance;
    return output;
}

fn roundedBox(point: vec2f, halfSize: vec2f, radius: f32) -> f32 {
    let q = abs(point) - halfSize + vec2f(radius);
    return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - radius;
}

fn coverage(distance: f32, antialias: f32) -> f32 {
    return 1.0 - smoothstep(-antialias, antialias, distance);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let base = input.instance * 5u;
    let geometry = shapes[base];
    var rgba = shapes[base + 1u];
    let parameters = shapes[base + 2u];
    let extra = shapes[base + 3u];
    let kind = u32(parameters.x + 0.5);
    let gaugeIndex = u32(max(extra.y, 0.0) + 0.5);
    let dynamicMode = u32(extra.z + 0.5);
    let dynamic = dynamics[gaugeIndex * 2u];
    let dynamicColor = dynamics[gaugeIndex * 2u + 1u];
    let halfSize = geometry.zw;
    let point = input.local * halfSize;
    // This unconditional derivative keeps the transition close to one physical pixel.
    let antialias = max(max(fwidth(point.x), fwidth(point.y)) * 0.5, 0.001);
    var alpha = 0.0;

    if (kind == 0u) {
        let radius = parameters.y;
        let border = parameters.z;
        let distance = roundedBox(point, halfSize, radius);
        alpha = coverage(distance, antialias);
        if (border > 0.0) {
            let inner = roundedBox(point, halfSize - vec2f(border), max(0.0, radius - border));
            alpha = alpha * (1.0 - coverage(inner, antialias));
        }
        if (dynamicMode == 2u && input.local.x > dynamic.x * 2.0 - 1.0) {
            discard;
        }
        if (dynamicMode == 3u && input.local.y < 1.0 - dynamic.x * 2.0) {
            discard;
        }
        if (dynamicMode == 6u) {
            rgba = dynamicColor;
        }
    } else if (kind == 1u) {
        let radius = length(point);
        let inner = parameters.w;
        let outer = extra.x;
        var endAngle = parameters.z;
        if (dynamicMode == 1u) {
            endAngle = mix(parameters.y, parameters.z, dynamic.x);
        }
        let angle = atan2(point.x, -point.y);
        let tau = 6.28318530718;
        var relative = angle - parameters.y;
        relative = relative - floor(relative / tau) * tau;
        var span = endAngle - parameters.y;
        span = span - floor(span / tau) * tau;
        if (abs(endAngle - parameters.y) >= tau - 0.001) {
            span = tau;
        }
        let ring = max(inner - radius, radius - outer);
        alpha = coverage(ring, antialias);
        if (relative > span) {
            discard;
        }
    } else if (kind == 2u) {
        let distance = roundedBox(point, halfSize, min(halfSize.x, halfSize.y));
        alpha = coverage(distance, antialias);
        if (dynamicMode == 2u && input.local.x > dynamic.x * 2.0 - 1.0) {
            discard;
        }
        if (dynamicMode == 3u && input.local.y < 1.0 - dynamic.x * 2.0) {
            discard;
        }
    } else if (kind == 3u) {
        var position = dynamic.x;
        if (dynamicMode == 4u) {
            let marker = abs(point.x - mix(-halfSize.x, halfSize.x, position));
            alpha = coverage(marker - parameters.y, antialias);
        } else {
            let marker = abs(point.y - mix(halfSize.y, -halfSize.y, position));
            alpha = coverage(marker - parameters.y, antialias);
        }
    } else if (kind == 4u) {
        let angle = dynamic.x * 6.28318530718;
        let direction = vec2f(sin(angle), -cos(angle));
        let along = dot(point, direction);
        let across = abs(point.x * direction.y - point.y * direction.x);
        let distance = max(across - parameters.y, max(-along, along - parameters.z));
        alpha = coverage(distance, antialias);
    } else if (kind == 5u) {
        let distance = length(point) - parameters.y;
        alpha = coverage(distance, antialias);
        if (dynamicMode == 6u) {
            rgba = dynamicColor;
        }
    } else if (kind == 6u) {
        let angle = dynamic.x * 6.28318530718;
        let direction = vec2f(sin(angle), -cos(angle));
        let along = dot(point, direction);
        let across = point.x * direction.y - point.y * direction.x;
        let markerPoint = vec2f(across, along - parameters.z);
        let distance = roundedBox(
            markerPoint,
            vec2f(parameters.y, parameters.w),
            parameters.y
        );
        alpha = coverage(distance, antialias);
    } else if (kind == 7u) {
        let angle = extra.x;
        let direction = vec2f(sin(angle), -cos(angle));
        let along = dot(point, direction);
        let across = point.x * direction.y - point.y * direction.x;
        let markerPoint = vec2f(across, along - parameters.z);
        let distance = roundedBox(
            markerPoint,
            vec2f(parameters.y, parameters.w),
            parameters.y
        );
        alpha = coverage(distance, antialias);
    }

    if (alpha <= 0.0) {
        discard;
    }
    return vec4f(rgba.rgb, rgba.a * alpha);
}
`;

export const TEXTURE_SHADER = /* wgsl */ `
struct Viewport {
    size: vec2f,
    _padding: vec2f,
}

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
    @location(1) color: vec4f,
}

@group(0) @binding(0) var<storage, read> sprites: array<vec4f>;
@group(0) @binding(1) var<uniform> viewport: Viewport;
@group(0) @binding(2) var atlas: texture_2d<f32>;
@group(0) @binding(3) var atlasSampler: sampler;

@vertex
fn vertexMain(@builtin(vertex_index) vertex: u32, @builtin(instance_index) instance: u32) -> VertexOutput {
    let corners = array<vec2f, 6>(
        vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
        vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
    );
    let base = instance * 4u;
    let geometry = sprites[base];
    let uvRect = sprites[base + 1u];
    let rgba = sprites[base + 2u];
    let transform = sprites[base + 3u];
    let local = corners[vertex];
    let offset = local * geometry.zw;
    let rotated = vec2f(
        offset.x * transform.x - offset.y * transform.y,
        offset.x * transform.y + offset.y * transform.x
    );
    let pixel = geometry.xy + rotated;
    let unit = local * 0.5 + vec2f(0.5);
    var output: VertexOutput;
    output.position = vec4f(pixel.x / viewport.size.x * 2.0 - 1.0, 1.0 - pixel.y / viewport.size.y * 2.0, 0.0, 1.0);
    output.uv = mix(uvRect.xy, uvRect.zw, unit);
    output.color = rgba;
    return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
    let sampled = textureSample(atlas, atlasSampler, input.uv);
    return vec4f(input.color.rgb, input.color.a * sampled.a);
}
`;
