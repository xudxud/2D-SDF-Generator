export interface LoadedImage {
  id: string;
  name: string;
  width: number;
  height: number;
  file: File;
  url: string;
}

export async function loadImageFile(file: File): Promise<LoadedImage> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image.`);
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close();

  return {
    id: crypto.randomUUID(),
    name: file.name,
    width,
    height,
    file,
    url: URL.createObjectURL(file),
  };
}

export async function savePng(blob: Blob, suggestedName: string) {
  if ("__TAURI_INTERNALS__" in window) {
    const [{ save }, { writeFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: "PNG image", extensions: ["png"] }],
    });
    if (path) await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
