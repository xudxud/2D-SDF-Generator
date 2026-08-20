# 2D SDF Generator

A local-first signed distance field generator for the Web and Windows. Images
are processed on the user's CPU and never leave the device.

> The new application is under active development. The original Unity Editor
> utility is preserved in [`legacy/unity-editor`](legacy/unity-editor/README.md).

## Features

- Exact Euclidean distance transform with consistent distances in every direction
- Legacy 8-neighbor chamfer mode for comparison with the Unity utility
- Single-mask signed distance fields
- Continuous fields composed from ordered, nested masks
- Luminance, alpha, and red-channel input modes
- Threshold, inversion, pixel-range, output-size, and posterization controls
- Non-blocking browser processing through a Web Worker
- Local PNG export with no image upload
- Shared React interface for GitHub Pages and Tauri desktop builds

## Use Online

After GitHub Pages is enabled, the application will be available at:

<https://xudxud.github.io/2D-SDF-Generator/>

A custom domain can be configured in **Settings > Pages** without changing the
application architecture. Once a custom domain is active, change
`VITE_BASE_PATH` in the Pages workflow from `/2D-SDF-Generator/` to `/`.

## Development

Requirements:

- Node.js 22 or newer
- Rust stable and the Tauri prerequisites for desktop development

```bash
npm install
npm run dev
```

Run tests and create a production Web build:

```bash
npm test
npm run build
```

Run the desktop application:

```bash
npm run tauri dev
```

Build Windows installers:

```bash
npm run tauri build
```

## Mask Ordering

A single source produces a conventional signed distance field, encoded around
mid-gray. White is inside and black is outside by default.

Multiple sources produce a continuous layered field. Sources must contain
nested masks and be ordered from the smallest white area to the largest. The
application reports pixels that violate this nesting rule.

## Algorithms

The default exact mode uses a separable squared Euclidean distance transform.
It runs in linear time with respect to the number of pixels. A one-pixel virtual
outside border gives finite distances to shapes touching the image boundary.

The legacy mode uses horizontal, vertical, and diagonal chamfer propagation.
It is faster to compare with the old implementation but has directional error
between the grid axes and 45-degree diagonals.

## Privacy and Performance

The hosted Web application is static. Image decoding, distance transforms, and
PNG encoding happen in the visiting browser. Generation runs in a Web Worker on
the local CPU, so GitHub Pages does not receive source images or perform the
calculation.

GPU acceleration is not currently used. WebGPU may be added later as an
optional accelerator while retaining the deterministic CPU implementation.

## Publishing

`.github/workflows/pages.yml` tests and deploys the Web build on each push to
`main`. Configure the repository's Pages source as **GitHub Actions**.

Pushing a tag such as `v0.1.0` runs the Windows Tauri workflow and creates a
draft GitHub Release containing the generated installers.

## License

[MIT](LICENSE)
