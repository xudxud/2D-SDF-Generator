import { chamferSignedDistance } from "./chamfer";
import { exactSignedDistance } from "./edt";
import type { GenerateOptions, GenerateResult, MaskChannel, SourceImage } from "./types";

function channelValue(
  pixels: Uint8ClampedArray,
  index: number,
  channel: MaskChannel,
) {
  if (channel === "alpha") return pixels[index + 3] / 255;
  if (channel === "red") return pixels[index] / 255;
  return (
    (pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722) /
    255
  );
}

function sampleCoverage(source: SourceImage, x: number, y: number, options: GenerateOptions) {
  const sourceX = ((x + 0.5) * source.width) / options.width - 0.5;
  const sourceY = ((y + 0.5) * source.height) / options.height - 0.5;
  const x0 = Math.max(0, Math.min(source.width - 1, Math.floor(sourceX)));
  const y0 = Math.max(0, Math.min(source.height - 1, Math.floor(sourceY)));
  const x1 = Math.min(source.width - 1, x0 + 1);
  const y1 = Math.min(source.height - 1, y0 + 1);
  const tx = Math.max(0, Math.min(1, sourceX - x0));
  const ty = Math.max(0, Math.min(1, sourceY - y0));
  const value = (sx: number, sy: number) =>
    channelValue(source.rgba, (sy * source.width + sx) * 4, options.channel);
  const top = value(x0, y0) * (1 - tx) + value(x1, y0) * tx;
  const bottom = value(x0, y1) * (1 - tx) + value(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

export function imageToMask(source: SourceImage, options: GenerateOptions) {
  const mask = new Uint8Array(options.width * options.height);
  for (let y = 0; y < options.height; y++) {
    for (let x = 0; x < options.width; x++) {
      const coverage = sampleCoverage(source, x, y, options);
      const inside = coverage >= options.threshold;
      mask[y * options.width + x] = inside !== options.invert ? 1 : 0;
    }
  }
  return mask;
}

export function generateSdf(
  sources: SourceImage[],
  options: GenerateOptions,
  onProgress?: (completed: number, total: number) => void,
): GenerateResult {
  if (sources.length === 0) throw new Error("Add at least one source image.");
  if (options.width < 1 || options.height < 1) throw new Error("Output dimensions must be positive.");
  if (options.width * options.height > 67_108_864) throw new Error("Output is too large.");
  if (options.pxRange <= 0) throw new Error("Pixel range must be greater than zero.");

  const pixelCount = options.width * options.height;
  const values = new Float32Array(pixelCount);
  const assigned = new Uint8Array(pixelCount);
  const conflictFlags = new Uint8Array(pixelCount);
  let previous: Float32Array | null = null;

  for (let index = 0; index < sources.length; index++) {
    const mask = imageToMask(sources[index], options);
    const current =
      options.algorithm === "exact"
        ? exactSignedDistance(mask, options.width, options.height)
        : chamferSignedDistance(mask, options.width, options.height);

    if (sources.length === 1) {
      for (let pixel = 0; pixel < pixelCount; pixel++) {
        values[pixel] = Math.max(
          0,
          Math.min(1, 0.5 + current[pixel] / (2 * options.pxRange)),
        );
      }
    } else if (!previous) {
      for (let pixel = 0; pixel < pixelCount; pixel++) {
        if (current[pixel] >= 0) {
          values[pixel] = 1;
          assigned[pixel] = 1;
        }
      }
    } else {
      const high = 1 - (index - 1) / (sources.length - 1);
      const low = 1 - index / (sources.length - 1);
      for (let pixel = 0; pixel < pixelCount; pixel++) {
        const inner = previous[pixel];
        const outer = current[pixel];
        if (inner >= 0 && outer < 0) conflictFlags[pixel] = 1;
        if (!assigned[pixel] && inner < 0 && outer >= 0) {
          const t = -inner / Math.max(1e-6, outer - inner);
          values[pixel] = high + (low - high) * t;
          assigned[pixel] = 1;
        }
      }
    }

    previous = current;
    onProgress?.(index + 1, sources.length);
  }

  const pixels = new Uint8ClampedArray(values.length * 4);
  const steps = Math.max(0, Math.floor(options.posterizeSteps));
  let conflicts = 0;

  for (let i = 0; i < values.length; i++) {
    conflicts += conflictFlags[i];
    let value = values[i];
    if (steps >= 2) value = Math.round(value * (steps - 1)) / (steps - 1);
    const byte = Math.round(value * 255);
    const offset = i * 4;
    pixels[offset] = byte;
    pixels[offset + 1] = byte;
    pixels[offset + 2] = byte;
    pixels[offset + 3] = 255;
  }

  return {
    width: options.width,
    height: options.height,
    pixels,
    conflictPixels: conflicts,
  };
}
