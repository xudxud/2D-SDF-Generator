import { describe, expect, it } from "vitest";
import { exactSignedDistance } from "./edt";
import { generateSdf } from "./generate";
import type { GenerateOptions, SourceImage } from "./types";

const options: GenerateOptions = {
  width: 3,
  height: 3,
  pxRange: 4,
  threshold: 0.5,
  channel: "red",
  invertOutput: false,
  algorithm: "exact",
  posterizeSteps: 0,
};

function source(mask: number[], name = "mask"): SourceImage {
  const rgba = new Uint8ClampedArray(mask.length * 4);
  mask.forEach((value, index) => {
    rgba[index * 4] = value ? 255 : 0;
    rgba[index * 4 + 3] = 255;
  });
  return { name, width: 3, height: 3, rgba };
}

describe("exactSignedDistance", () => {
  it("returns half-pixel signed distances at a binary edge", () => {
    const result = exactSignedDistance(new Uint8Array([0, 0, 0, 0, 1, 0, 0, 0, 0]), 3, 3);
    expect(result[4]).toBeCloseTo(0.5);
    expect(result[1]).toBeCloseTo(-0.5);
    expect(result[0]).toBeCloseTo(-(Math.SQRT2 - 0.5));
  });

  it("uses the image boundary as outside padding", () => {
    expect(exactSignedDistance(new Uint8Array([1]), 1, 1)[0]).toBeCloseTo(0.5);
  });

  it("handles masks without any inside pixels", () => {
    const result = exactSignedDistance(new Uint8Array(9), 3, 3);
    expect(result.every((distance) => Number.isFinite(distance) && distance < 0)).toBe(true);
  });
});

describe("generateSdf", () => {
  it("encodes a single signed distance field around midpoint gray", () => {
    const result = generateSdf([source([0, 0, 0, 0, 1, 0, 0, 0, 0])], options);
    expect(result.pixels[4 * 4]).toBeGreaterThan(128);
    expect(result.pixels[1 * 4]).toBeLessThan(128);
  });

  it("composes nested masks from white-area-smallest to largest", () => {
    const inner = source([0, 0, 0, 0, 1, 0, 0, 0, 0], "inner");
    const outer = source([1, 1, 1, 1, 1, 1, 1, 1, 1], "outer");
    const result = generateSdf([inner, outer], options);
    expect(result.pixels[4 * 4]).toBe(255);
    expect(result.pixels[0]).toBeLessThan(255);
    expect(result.conflictPixels).toBe(0);
  });

  it("inverts only the final output values", () => {
    const mask = source([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    const normal = generateSdf([mask], options);
    const inverted = generateSdf([mask], { ...options, invertOutput: true });

    for (let pixel = 0; pixel < options.width * options.height; pixel++) {
      expect(normal.pixels[pixel * 4] + inverted.pixels[pixel * 4]).toBe(255);
    }
    expect(inverted.conflictPixels).toBe(normal.conflictPixels);
  });
});
