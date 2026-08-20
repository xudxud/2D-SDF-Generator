const FAR = 1e9;
const SQRT_2 = Math.SQRT2;

function sweep(grid: Float32Array, width: number, height: number) {
  const relax = (x: number, y: number, ox: number, oy: number, cost: number) => {
    const nx = x + ox;
    const ny = y + oy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
    const index = y * width + x;
    const candidate = grid[ny * width + nx] + cost;
    if (candidate < grid[index]) grid[index] = candidate;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      relax(x, y, -1, 0, 1);
      relax(x, y, 0, -1, 1);
      relax(x, y, -1, -1, SQRT_2);
      relax(x, y, 1, -1, SQRT_2);
    }
    for (let x = width - 1; x >= 0; x--) relax(x, y, 1, 0, 1);
  }

  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      relax(x, y, 1, 0, 1);
      relax(x, y, 0, 1, 1);
      relax(x, y, -1, 1, SQRT_2);
      relax(x, y, 1, 1, SQRT_2);
    }
    for (let x = 0; x < width; x++) relax(x, y, -1, 0, 1);
  }
}

export function chamferSignedDistance(mask: Uint8Array, width: number, height: number) {
  const paddedWidth = width + 2;
  const paddedHeight = height + 2;
  const toInside = new Float32Array(paddedWidth * paddedHeight);
  const toOutside = new Float32Array(paddedWidth * paddedHeight);

  for (let y = 0; y < paddedHeight; y++) {
    for (let x = 0; x < paddedWidth; x++) {
      const paddedIndex = y * paddedWidth + x;
      const isBorder = x === 0 || y === 0 || x === paddedWidth - 1 || y === paddedHeight - 1;
      const isInside = !isBorder && mask[(y - 1) * width + x - 1] === 1;
      toInside[paddedIndex] = isInside ? 0 : FAR;
      toOutside[paddedIndex] = isInside ? FAR : 0;
    }
  }

  sweep(toInside, paddedWidth, paddedHeight);
  sweep(toOutside, paddedWidth, paddedHeight);
  const signed = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const paddedIndex = (y + 1) * paddedWidth + x + 1;
      signed[index] = mask[index]
        ? toOutside[paddedIndex] - 0.5
        : -(toInside[paddedIndex] - 0.5);
    }
  }

  return signed;
}
