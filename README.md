# 2D SDF Generator

A small, local-first tool for generating 2D signed distance fields in your
browser or on Windows. Your images stay on your device.

[Try it online](https://xudxud.github.io/2D-SDF-Generator/)
· [Download for Windows](https://github.com/xudxud/2D-SDF-Generator/releases/latest)
· [Legacy Unity version](legacy/unity-editor/README.md)

<p align="center">
  <img
    width="306"
    src="https://raw.githubusercontent.com/clarkxdy/Common/main/b/images/img_SDF-Generator/face_preview.gif"
    alt="Layered SDF demo"
  >
</p>

## Features

- Exact Euclidean signed distance fields
- Single masks and layered nested masks
- Luminance, alpha, and red-channel input
- Threshold, inversion, pixel range, and posterization controls
- Local CPU processing with no uploads
- PNG export in both Web and Windows versions

## Using Multiple Masks

For a regular SDF, just add one mask.

To create a layered field, order nested masks from the smallest white area at
the top to the largest at the bottom. Files are sorted naturally by name when
you add them, and you can drag rows or use **Reverse Order** to adjust the list.

The app will warn you if the masks do not follow the expected nesting order.

## Development

```bash
npm install
npm run dev
```

Run the tests and build the Web version:

```bash
npm test
npm run build
```

Run the Tauri desktop version:

```bash
npm run tauri dev
```

## Legacy Unity Version

The original Unity Editor tool and its demo files are preserved in
[`legacy/unity-editor`](legacy/unity-editor/README.md).

## License

[MIT](LICENSE)
