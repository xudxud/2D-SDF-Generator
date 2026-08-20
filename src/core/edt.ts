const INF = 1e20;

export interface ExactEdtWorkspace {
  width: number;
  height: number;
  features: Uint8Array;
  distances: Float64Array;
  input: Float64Array;
  output: Float64Array;
  sites: Int32Array;
  boundaries: Float64Array;
}

export function createExactEdtWorkspace(width: number, height: number): ExactEdtWorkspace {
  const paddedWidth = width + 2;
  const paddedHeight = height + 2;
  const maxDimension = Math.max(paddedWidth, paddedHeight);
  return {
    width,
    height,
    features: new Uint8Array(paddedWidth * paddedHeight),
    distances: new Float64Array(paddedWidth * paddedHeight),
    input: new Float64Array(maxDimension),
    output: new Float64Array(maxDimension),
    sites: new Int32Array(maxDimension),
    boundaries: new Float64Array(maxDimension + 1),
  };
}

function transform1d(workspace: ExactEdtWorkspace, length: number) {
  const { input, output, sites, boundaries } = workspace;
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

function distanceTransform(workspace: ExactEdtWorkspace) {
  const width = workspace.width + 2;
  const height = workspace.height + 2;
  const { features, distances, input, output } = workspace;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) input[x] = features[row + x] ? 0 : INF;
    transform1d(workspace, width);
    for (let x = 0; x < width; x++) distances[row + x] = output[x];
  }

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) input[y] = distances[y * width + x];
    transform1d(workspace, height);
    for (let y = 0; y < height; y++) distances[y * width + x] = output[y];
  }
}

export function exactSignedDistance(
  mask: Uint8Array,
  width: number,
  height: number,
  providedWorkspace?: ExactEdtWorkspace,
  providedOutput?: Float32Array,
) {
  const workspace =
    providedWorkspace?.width === width && providedWorkspace.height === height
      ? providedWorkspace
      : createExactEdtWorkspace(width, height);
  const paddedWidth = width + 2;
  const { features, distances } = workspace;
  const signed = providedOutput ?? new Float32Array(width * height);

  features.fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      features[(y + 1) * paddedWidth + x + 1] = mask[y * width + x];
    }
  }
  distanceTransform(workspace);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!mask[index]) {
        signed[index] = -(Math.sqrt(distances[(y + 1) * paddedWidth + x + 1]) - 0.5);
      }
    }
  }

  // The padded border remains outside, so edge-touching shapes have finite distances.
  features.fill(1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      features[(y + 1) * paddedWidth + x + 1] = mask[y * width + x] ? 0 : 1;
    }
  }
  distanceTransform(workspace);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (mask[index]) {
        signed[index] = Math.sqrt(distances[(y + 1) * paddedWidth + x + 1]) - 0.5;
      }
    }
  }

  return signed;
}
