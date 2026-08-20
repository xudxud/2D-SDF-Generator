const INF = 1e20;

function transform1d(
  input: Float64Array,
  output: Float64Array,
  length: number,
  sites: Int32Array,
  boundaries: Float64Array,
) {
  let k = 0;
  sites[0] = 0;
  boundaries[0] = -INF;
  boundaries[1] = INF;

  for (let q = 1; q < length; q++) {
    let site = sites[k];
    let intersection =
      (input[q] + q * q - (input[site] + site * site)) / (2 * (q - site));

    while (intersection <= boundaries[k]) {
      k--;
      site = sites[k];
      intersection =
        (input[q] + q * q - (input[site] + site * site)) / (2 * (q - site));
    }

    k++;
    sites[k] = q;
    boundaries[k] = intersection;
    boundaries[k + 1] = INF;
  }

  k = 0;
  for (let q = 0; q < length; q++) {
    while (boundaries[k + 1] < q) k++;
    const delta = q - sites[k];
    output[q] = delta * delta + input[sites[k]];
  }
}

export function squaredDistanceTransform(
  features: Uint8Array,
  width: number,
  height: number,
): Float64Array {
  const size = width * height;
  const temporary = new Float64Array(size);
  const result = new Float64Array(size);
  const maxDimension = Math.max(width, height);
  const input = new Float64Array(maxDimension);
  const output = new Float64Array(maxDimension);
  const sites = new Int32Array(maxDimension);
  const boundaries = new Float64Array(maxDimension + 1);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) input[x] = features[row + x] ? 0 : INF;
    transform1d(input, output, width, sites, boundaries);
    for (let x = 0; x < width; x++) temporary[row + x] = output[x];
  }

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) input[y] = temporary[y * width + x];
    transform1d(input, output, height, sites, boundaries);
    for (let y = 0; y < height; y++) result[y * width + x] = output[y];
  }

  return result;
}

export function exactSignedDistance(mask: Uint8Array, width: number, height: number) {
  // A one-pixel outside border gives shapes touching the image edge a finite distance.
  const paddedWidth = width + 2;
  const paddedHeight = height + 2;
  const inside = new Uint8Array(paddedWidth * paddedHeight);
  const outside = new Uint8Array(paddedWidth * paddedHeight);
  outside.fill(1);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceIndex = y * width + x;
      const targetIndex = (y + 1) * paddedWidth + x + 1;
      inside[targetIndex] = mask[sourceIndex];
      outside[targetIndex] = mask[sourceIndex] ? 0 : 1;
    }
  }

  const distanceToInside = squaredDistanceTransform(inside, paddedWidth, paddedHeight);
  const distanceToOutside = squaredDistanceTransform(outside, paddedWidth, paddedHeight);
  const signed = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const paddedIndex = (y + 1) * paddedWidth + x + 1;
      signed[index] = mask[index]
        ? Math.sqrt(distanceToOutside[paddedIndex]) - 0.5
        : -(Math.sqrt(distanceToInside[paddedIndex]) - 0.5);
    }
  }

  return signed;
}
