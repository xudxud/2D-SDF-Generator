/// <reference lib="webworker" />

import { imageToMask, SdfGenerator } from "../core/generate";
import type {
  GenerateRequest,
  SourceImage,
  WorkerRequest,
  WorkerResponse,
} from "../core/types";
import { WebGpuSdfGenerator } from "./webgpu-sdf";

interface RegisteredSource {
  id: string;
  name: string;
  width: number;
  height: number;
  file: Blob;
}

const sources = new Map<string, RegisteredSource>();

async function decodeSource(source: RegisteredSource): Promise<SourceImage> {
  const bitmap = await createImageBitmap(source.file);
  const canvas = new OffscreenCanvas(source.width, source.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new Error(`Could not decode ${source.name}.`);
  }
  context.drawImage(bitmap, 0, 0, source.width, source.height);
  const rgba = context.getImageData(0, 0, source.width, source.height).data;
  bitmap.close();
  canvas.width = 1;
  canvas.height = 1;
  return { name: source.name, width: source.width, height: source.height, rgba };
}

async function generateOnCpu(request: GenerateRequest) {
  const options =
    request.options.algorithm === "gpu"
      ? { ...request.options, algorithm: "exact" as const }
      : request.options;
  const generator = new SdfGenerator(options, request.sourceIds.length);

  for (let index = 0; index < request.sourceIds.length; index++) {
    const source = sources.get(request.sourceIds[index]);
    if (!source) throw new Error("A source image is no longer available.");
    generator.addSource(await decodeSource(source));
    const response: WorkerResponse = {
      type: "progress",
      id: request.id,
      completed: index + 1,
      total: request.sourceIds.length,
    };
    self.postMessage(response);
  }

  return generator.finish();
}

async function generateOnGpu(request: GenerateRequest) {
  const generator = await WebGpuSdfGenerator.create(request.options, request.sourceIds.length);
  try {
    for (let index = 0; index < request.sourceIds.length; index++) {
      const source = sources.get(request.sourceIds[index]);
      if (!source) throw new Error("A source image is no longer available.");
      const decoded = await decodeSource(source);
      generator.addMask(imageToMask(decoded, request.options));
      const response: WorkerResponse = {
        type: "progress",
        id: request.id,
        completed: index + 1,
        total: request.sourceIds.length,
      };
      self.postMessage(response);
    }
    return await generator.finish();
  } catch (error) {
    generator.destroy();
    throw error;
  }
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "register-source") {
    sources.set(request.source.id, request.source);
    return;
  }
  if (request.type === "remove-source") {
    sources.delete(request.id);
    return;
  }

  try {
    let result;
    if (request.options.algorithm === "gpu") {
      try {
        result = await generateOnGpu(request);
      } catch (gpuError) {
        result = await generateOnCpu(request);
        const reason = gpuError instanceof Error ? gpuError.message : "WebGPU failed.";
        result.notice = `${reason} Exact CPU mode was used instead.`;
      }
    } else {
      result = await generateOnCpu(request);
    }
    const response: WorkerResponse = { type: "result", id: request.id, result };
    self.postMessage(response, { transfer: [result.pixels.buffer] });
  } catch (error) {
    const response: WorkerResponse = {
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : "Generation failed.",
    };
    self.postMessage(response);
  }
};

export {};
