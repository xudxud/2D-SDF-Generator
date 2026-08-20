import { chamferSignedDistance } from "./chamfer";
import { createExactEdtWorkspace, exactSignedDistance, type ExactEdtWorkspace } from "./edt";
import type { GenerateOptions, GenerateResult, SourceImage } from "./types";

export function imageToMask(
  source: SourceImage,
  options: GenerateOptions,
  providedMask?: Uint8Array,
) {
  const mask = providedMask ?? new Uint8Array(options.width * options.height);
  const pixels = source.rgba;
  const readChannel =
    options.channel === "alpha"
      ? (index: number) => pixels[index + 3] / 255
      : options.channel === "red"
        ? (index: number) => pixels[index] / 255
        : (index: number) =>
            (pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722) /
            255;

  if (source.width === options.width && source.height === options.height) {
    for (let index = 0; index < mask.length; index++) {
      mask[index] = readChannel(index * 4) >= options.threshold ? 1 : 0;
    }
    return mask;
  }

  const x0 = new Int32Array(options.width);
  const x1 = new Int32Array(options.width);
  const tx = new Float64Array(options.width);
  for (let x = 0; x < options.width; x++) {
    const sourceX = ((x + 0.5) * source.width) / options.width - 0.5;
    x0[x] = Math.max(0, Math.min(source.width - 1, Math.floor(sourceX)));
    x1[x] = Math.min(source.width - 1, x0[x] + 1);
    tx[x] = Math.max(0, Math.min(1, sourceX - x0[x]));
  }

  for (let y = 0; y < options.height; y++) {
    const sourceY = ((y + 0.5) * source.height) / options.height - 0.5;
    const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(sourceY)));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const ty = Math.max(0, Math.min(1, sourceY - y0));
    for (let x = 0; x < options.width; x++) {
      const topLeft = readChannel((y0 * source.width + x0[x]) * 4);
      const topRight = readChannel((y0 * source.width + x1[x]) * 4);
      const bottomLeft = readChannel((y1 * source.width + x0[x]) * 4);
      const bottomRight = readChannel((y1 * source.width + x1[x]) * 4);
      const top = topLeft * (1 - tx[x]) + topRight * tx[x];
      const bottom = bottomLeft * (1 - tx[x]) + bottomRight * tx[x];
      const coverage = top * (1 - ty) + bottom * ty;
      const inside = coverage >= options.threshold;
      mask[y * options.width + x] = inside ? 1 : 0;
    }
  }
  return mask;
}

export function generateSdf(
  sources: SourceImage[],
  options: GenerateOptions,
  onProgress?: (completed: number, total: number) => void,
): GenerateResult {
  const generator = new SdfGenerator(options, sources.length);
  sources.forEach((source, index) => {
    generator.addSource(source);
    onProgress?.(index + 1, sources.length);
  });
  return generator.finish();
}

export class SdfGenerator {
  private readonly options: GenerateOptions;
  private readonly sourceCount: number;
  private readonly pixelCount: number;
  private readonly values: Float32Array;
  private readonly assigned: Uint8Array;
  private readonly conflictFlags: Uint8Array;
  private readonly mask: Uint8Array;
  private readonly exactWorkspace?: ExactEdtWorkspace;
  private readonly distanceA: Float32Array;
  private readonly distanceB: Float32Array;
  private previous: Float32Array | null = null;
  private addedSources = 0;

  constructor(options: GenerateOptions, sourceCount: number) {
    if (sourceCount === 0) throw new Error("Add at least one source image.");
    if (options.width < 1 || options.height < 1) throw new Error("Output dimensions must be positive.");
    if (options.width * options.height > 67_108_864) throw new Error("Output is too large.");
    if (options.pxRange <= 0) throw new Error("Pixel range must be greater than zero.");

    this.options = options;
    this.sourceCount = sourceCount;
    this.pixelCount = options.width * options.height;
    this.values = new Float32Array(this.pixelCount);
    this.assigned = new Uint8Array(this.pixelCount);
    this.conflictFlags = new Uint8Array(this.pixelCount);
    this.mask = new Uint8Array(this.pixelCount);
    this.exactWorkspace =
      options.algorithm === "chamfer"
        ? undefined
        : createExactEdtWorkspace(options.width, options.height);
    this.distanceA = new Float32Array(this.pixelCount);
    this.distanceB = new Float32Array(this.pixelCount);
  }

  addSource(source: SourceImage) {
    const index = this.addedSources;
    if (index >= this.sourceCount) throw new Error("Too many source images were added.");
    const mask = imageToMask(source, this.options, this.mask);
    const target = this.previous === this.distanceA ? this.distanceB : this.distanceA;
    const current =
      this.options.algorithm === "chamfer"
        ? chamferSignedDistance(mask, this.options.width, this.options.height)
        : exactSignedDistance(
            mask,
            this.options.width,
            this.options.height,
            this.exactWorkspace,
            target,
          );

    if (this.sourceCount === 1) {
      for (let pixel = 0; pixel < this.pixelCount; pixel++) {
        this.values[pixel] = Math.max(
          0,
          Math.min(1, 0.5 + current[pixel] / (2 * this.options.pxRange)),
        );
      }
    } else if (!this.previous) {
      for (let pixel = 0; pixel < this.pixelCount; pixel++) {
        if (current[pixel] >= 0) {
          this.values[pixel] = 1;
          this.assigned[pixel] = 1;
        }
      }
    } else {
      const high = 1 - (index - 1) / (this.sourceCount - 1);
      const low = 1 - index / (this.sourceCount - 1);
      for (let pixel = 0; pixel < this.pixelCount; pixel++) {
        const inner = this.previous[pixel];
        const outer = current[pixel];
        if (inner >= 0 && outer < 0) this.conflictFlags[pixel] = 1;
        if (!this.assigned[pixel] && inner < 0 && outer >= 0) {
          const t = -inner / Math.max(1e-6, outer - inner);
          this.values[pixel] = high + (low - high) * t;
          this.assigned[pixel] = 1;
        }
      }
    }

    this.previous = current;
    this.addedSources++;
  }

  finish(): GenerateResult {
    if (this.addedSources !== this.sourceCount) throw new Error("Not all source images were processed.");
    const pixels = new Uint8ClampedArray(this.pixelCount * 4);
    const steps = Math.max(0, Math.floor(this.options.posterizeSteps));
    let conflicts = 0;

    for (let i = 0; i < this.pixelCount; i++) {
      conflicts += this.conflictFlags[i];
      let value = this.values[i];
      if (steps >= 2) value = Math.round(value * (steps - 1)) / (steps - 1);
      if (this.options.invertOutput) value = 1 - value;
      const byte = Math.round(value * 255);
      const offset = i * 4;
      pixels[offset] = byte;
      pixels[offset + 1] = byte;
      pixels[offset + 2] = byte;
      pixels[offset + 3] = 255;
    }

    return {
      width: this.options.width,
      height: this.options.height,
      pixels,
      conflictPixels: conflicts,
      backend: "cpu",
    };
  }
}
