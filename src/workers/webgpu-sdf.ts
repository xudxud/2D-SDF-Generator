import type { GenerateOptions, GenerateResult } from "../core/types";

const WORKGROUP_SIZE = 16;
const INVALID_SEED = 0xffffffff;

const SHADERS = /* wgsl */ `
struct Params {
  width: u32,
  height: u32,
  step: u32,
  layer: u32,
  layerCount: u32,
  pxRange: f32,
  posterize: u32,
  invertOutput: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> dataA: array<u32>;
@group(0) @binding(2) var<storage, read_write> dataB: array<u32>;
@group(0) @binding(3) var<storage, read_write> dataC: array<u32>;
@group(0) @binding(4) var<storage, read_write> dataD: array<u32>;
@group(0) @binding(5) var<storage, read_write> atomicData: atomic<u32>;

fn indexOf(position: vec2u) -> u32 {
  return position.y * params.width + position.x;
}

fn packSeed(position: vec2u) -> u32 {
  return position.x | (position.y << 16u);
}

fn unpackSeed(seed: u32) -> vec2u {
  return vec2u(seed & 0xffffu, seed >> 16u);
}

@compute @workgroup_size(16, 16)
fn initSeedsMain(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) { return; }
  let position = id.xy;
  let index = indexOf(position);
  let inside = dataA[index];
  var edge = false;

  if (inside == 1u && (position.x == 0u || position.y == 0u || position.x + 1u == params.width || position.y + 1u == params.height)) {
    edge = true;
  }
  if (position.x > 0u && dataA[index - 1u] != inside) { edge = true; }
  if (position.x + 1u < params.width && dataA[index + 1u] != inside) { edge = true; }
  if (position.y > 0u && dataA[index - params.width] != inside) { edge = true; }
  if (position.y + 1u < params.height && dataA[index + params.width] != inside) { edge = true; }

  dataB[index] = select(${INVALID_SEED}u, packSeed(position), edge);
}

@compute @workgroup_size(16, 16)
fn jumpMain(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) { return; }
  let position = id.xy;
  let index = indexOf(position);
  var bestSeed = dataA[index];
  var bestDistance = 0xffffffffu;
  if (bestSeed != ${INVALID_SEED}u) {
    let seed = unpackSeed(bestSeed);
    let delta = vec2i(position) - vec2i(seed);
    bestDistance = u32(delta.x * delta.x + delta.y * delta.y);
  }

  let step = i32(params.step);
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let samplePosition = vec2i(position) + vec2i(ox * step, oy * step);
      if (samplePosition.x < 0 || samplePosition.y < 0 || samplePosition.x >= i32(params.width) || samplePosition.y >= i32(params.height)) { continue; }
      let candidate = dataA[u32(samplePosition.y) * params.width + u32(samplePosition.x)];
      if (candidate == ${INVALID_SEED}u) { continue; }
      let seed = unpackSeed(candidate);
      let delta = vec2i(position) - vec2i(seed);
      let distance = u32(delta.x * delta.x + delta.y * delta.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSeed = candidate;
      }
    }
  }
  dataB[index] = bestSeed;
}

@compute @workgroup_size(16, 16)
fn signedMain(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) { return; }
  let position = id.xy;
  let index = indexOf(position);
  let packed = dataB[index];
  var distance = 1000000000.0;
  if (packed != ${INVALID_SEED}u) {
    let seed = unpackSeed(packed);
    let delta = vec2f(position) - vec2f(seed);
    distance = sqrt(dot(delta, delta)) + 0.5;
  }
  dataC[index] = bitcast<u32>(select(-distance, distance, dataA[index] == 1u));
}

@compute @workgroup_size(16, 16)
fn composeMain(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) { return; }
  let index = id.y * params.width + id.x;
  let current = bitcast<f32>(dataB[index]);

  if (params.layerCount == 1u) {
    dataC[index] = bitcast<u32>(clamp(0.5 + current / (2.0 * params.pxRange), 0.0, 1.0));
    return;
  }
  if (params.layer == 0u) {
    if (current >= 0.0) {
      dataC[index] = bitcast<u32>(1.0);
      dataD[index] = dataD[index] | 1u;
    }
    return;
  }

  let previous = bitcast<f32>(dataA[index]);
  var state = dataD[index];
  if (previous >= 0.0 && current < 0.0 && (state & 2u) == 0u) {
    state = state | 2u;
    atomicAdd(&atomicData, 1u);
  }
  if ((state & 1u) == 0u && previous < 0.0 && current >= 0.0) {
    let high = 1.0 - f32(params.layer - 1u) / f32(params.layerCount - 1u);
    let low = 1.0 - f32(params.layer) / f32(params.layerCount - 1u);
    let t = -previous / max(0.000001, current - previous);
    dataC[index] = bitcast<u32>(mix(high, low, t));
    state = state | 1u;
  }
  dataD[index] = state;
}

@compute @workgroup_size(16, 16)
fn finalMain(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.width || id.y >= params.height) { return; }
  let index = id.y * params.width + id.x;
  var value = bitcast<f32>(dataA[index]);
  if (params.posterize >= 2u) {
    let levels = f32(params.posterize - 1u);
    value = round(value * levels) / levels;
  }
  if (params.invertOutput == 1u) { value = 1.0 - value; }
  let byte = u32(round(clamp(value, 0.0, 1.0) * 255.0));
  dataB[index] = byte | (byte << 8u) | (byte << 16u) | (255u << 24u);
}
`;

let devicePromise: Promise<GPUDevice> | null = null;

async function getDevice() {
  if (!navigator.gpu) throw new Error("WebGPU is not supported by this browser.");
  if (!devicePromise) {
    devicePromise = navigator.gpu.requestAdapter({ powerPreference: "high-performance" }).then(async (adapter) => {
      if (!adapter) throw new Error("No WebGPU adapter is available.");
      const device = await adapter.requestDevice();
      void device.lost.then(() => {
        devicePromise = null;
      });
      return device;
    });
  }
  try {
    return await devicePromise;
  } catch (error) {
    devicePromise = null;
    throw error;
  }
}

function storageBuffer(device: GPUDevice, size: number, extraUsage = 0) {
  return device.createBuffer({
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extraUsage,
  });
}

export class WebGpuSdfGenerator {
  static async create(options: GenerateOptions, sourceCount: number) {
    const device = await getDevice();
    device.pushErrorScope("validation");
    let generator: WebGpuSdfGenerator | undefined;
    try {
      generator = new WebGpuSdfGenerator(device, options, sourceCount);
    } finally {
      const validationError = await device.popErrorScope();
      if (validationError) {
        generator?.destroy();
        throw new Error(validationError.message);
      }
    }
    return generator;
  }

  private readonly device: GPUDevice;
  private readonly options: GenerateOptions;
  private readonly sourceCount: number;
  private readonly pixelCount: number;
  private readonly byteSize: number;
  private readonly params: GPUBuffer;
  private readonly mask: GPUBuffer;
  private readonly seedsA: GPUBuffer;
  private readonly seedsB: GPUBuffer;
  private readonly distanceA: GPUBuffer;
  private readonly distanceB: GPUBuffer;
  private readonly values: GPUBuffer;
  private readonly states: GPUBuffer;
  private readonly conflicts: GPUBuffer;
  private readonly output: GPUBuffer;
  private readonly readback: GPUBuffer;
  private readonly maskWords: Uint32Array;
  private readonly initPipeline: GPUComputePipeline;
  private readonly jumpPipeline: GPUComputePipeline;
  private readonly signedPipeline: GPUComputePipeline;
  private readonly composePipeline: GPUComputePipeline;
  private readonly finalPipeline: GPUComputePipeline;
  private previousDistance: GPUBuffer | null = null;
  private addedSources = 0;

  private constructor(device: GPUDevice, options: GenerateOptions, sourceCount: number) {
    if (options.width > 65535 || options.height > 65535) throw new Error("GPU mode supports dimensions up to 65535.");
    this.device = device;
    this.options = options;
    this.sourceCount = sourceCount;
    this.pixelCount = options.width * options.height;
    this.byteSize = this.pixelCount * 4;
    if (
      this.byteSize > device.limits.maxStorageBufferBindingSize ||
      this.byteSize + 4 > device.limits.maxBufferSize
    ) {
      throw new Error("This GPU cannot allocate a storage buffer large enough for the requested output.");
    }

    this.params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.mask = storageBuffer(device, this.byteSize);
    this.seedsA = storageBuffer(device, this.byteSize);
    this.seedsB = storageBuffer(device, this.byteSize);
    this.distanceA = storageBuffer(device, this.byteSize);
    this.distanceB = storageBuffer(device, this.byteSize);
    this.values = storageBuffer(device, this.byteSize);
    this.states = storageBuffer(device, this.byteSize);
    this.conflicts = storageBuffer(device, 4, GPUBufferUsage.COPY_SRC);
    this.output = storageBuffer(device, this.byteSize, GPUBufferUsage.COPY_SRC);
    this.readback = device.createBuffer({
      size: this.byteSize + 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.maskWords = new Uint32Array(this.pixelCount);

    const module = device.createShaderModule({ code: SHADERS });
    this.initPipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "initSeedsMain" } });
    this.jumpPipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "jumpMain" } });
    this.signedPipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "signedMain" } });
    this.composePipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "composeMain" } });
    this.finalPipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "finalMain" } });

    const clear = device.createCommandEncoder();
    clear.clearBuffer(this.values);
    clear.clearBuffer(this.states);
    clear.clearBuffer(this.conflicts);
    device.queue.submit([clear.finish()]);
  }

  private writeParams(step: number, layer: number) {
    const data = new ArrayBuffer(32);
    const view = new DataView(data);
    view.setUint32(0, this.options.width, true);
    view.setUint32(4, this.options.height, true);
    view.setUint32(8, step, true);
    view.setUint32(12, layer, true);
    view.setUint32(16, this.sourceCount, true);
    view.setFloat32(20, this.options.pxRange, true);
    view.setUint32(24, Math.max(0, Math.floor(this.options.posterizeSteps)), true);
    view.setUint32(28, this.options.invertOutput ? 1 : 0, true);
    this.device.queue.writeBuffer(this.params, 0, data);
  }

  private dispatch(pipeline: GPUComputePipeline, entries: GPUBindGroupEntry[]) {
    const bindGroup = this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.params } }, ...entries],
    });
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(this.options.width / WORKGROUP_SIZE),
      Math.ceil(this.options.height / WORKGROUP_SIZE),
    );
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  addMask(mask: Uint8Array) {
    const layer = this.addedSources;
    if (layer >= this.sourceCount) throw new Error("Too many GPU masks were added.");
    for (let index = 0; index < this.pixelCount; index++) this.maskWords[index] = mask[index];
    this.device.queue.writeBuffer(this.mask, 0, this.maskWords.buffer as ArrayBuffer);

    this.writeParams(0, layer);
    this.dispatch(this.initPipeline, [
      { binding: 1, resource: { buffer: this.mask } },
      { binding: 2, resource: { buffer: this.seedsA } },
    ]);

    let source = this.seedsA;
    let target = this.seedsB;
    let step = 1;
    while (step < Math.max(this.options.width, this.options.height)) step *= 2;
    const steps: number[] = [];
    for (step = Math.floor(step / 2); step >= 1; step = Math.floor(step / 2)) steps.push(step);
    steps.push(2, 1);

    for (const jump of steps) {
      this.writeParams(jump, layer);
      this.dispatch(this.jumpPipeline, [
        { binding: 1, resource: { buffer: source } },
        { binding: 2, resource: { buffer: target } },
      ]);
      [source, target] = [target, source];
    }

    const currentDistance = this.previousDistance === this.distanceA ? this.distanceB : this.distanceA;
    this.writeParams(0, layer);
    this.dispatch(this.signedPipeline, [
      { binding: 1, resource: { buffer: this.mask } },
      { binding: 2, resource: { buffer: source } },
      { binding: 3, resource: { buffer: currentDistance } },
    ]);
    const previousForBinding =
      this.previousDistance ?? (currentDistance === this.distanceA ? this.distanceB : this.distanceA);
    this.dispatch(this.composePipeline, [
      { binding: 1, resource: { buffer: previousForBinding } },
      { binding: 2, resource: { buffer: currentDistance } },
      { binding: 3, resource: { buffer: this.values } },
      { binding: 4, resource: { buffer: this.states } },
      { binding: 5, resource: { buffer: this.conflicts } },
    ]);

    this.previousDistance = currentDistance;
    this.addedSources++;
  }

  async finish(): Promise<GenerateResult> {
    if (this.addedSources !== this.sourceCount) throw new Error("Not all GPU masks were processed.");
    this.writeParams(0, Math.max(0, this.sourceCount - 1));
    this.dispatch(this.finalPipeline, [
      { binding: 1, resource: { buffer: this.values } },
      { binding: 2, resource: { buffer: this.output } },
    ]);

    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.output, 0, this.readback, 0, this.byteSize);
    encoder.copyBufferToBuffer(this.conflicts, 0, this.readback, this.byteSize, 4);
    this.device.queue.submit([encoder.finish()]);
    await this.readback.mapAsync(GPUMapMode.READ);
    const mapped = this.readback.getMappedRange();
    const pixels = new Uint8ClampedArray(mapped.slice(0, this.byteSize));
    const conflictPixels = new DataView(mapped, this.byteSize, 4).getUint32(0, true);
    this.readback.unmap();
    this.destroy();

    return {
      width: this.options.width,
      height: this.options.height,
      pixels,
      conflictPixels,
      backend: "webgpu",
    };
  }

  destroy() {
    this.params.destroy();
    this.mask.destroy();
    this.seedsA.destroy();
    this.seedsB.destroy();
    this.distanceA.destroy();
    this.distanceB.destroy();
    this.values.destroy();
    this.states.destroy();
    this.conflicts.destroy();
    this.output.destroy();
    this.readback.destroy();
  }
}
