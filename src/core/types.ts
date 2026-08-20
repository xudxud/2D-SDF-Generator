export type Algorithm = "exact" | "gpu" | "chamfer";
export type MaskChannel = "alpha" | "luminance" | "red";
export type ProcessingBackend = "cpu" | "webgpu";

export interface SourceImage {
  name: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface GenerateOptions {
  width: number;
  height: number;
  pxRange: number;
  threshold: number;
  channel: MaskChannel;
  invertOutput: boolean;
  algorithm: Algorithm;
  posterizeSteps: number;
}

export interface GenerateResult {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  conflictPixels: number;
  backend: ProcessingBackend;
  notice?: string;
}

export interface GenerateRequest {
  type: "generate";
  id: number;
  sourceIds: string[];
  options: GenerateOptions;
}

export interface RegisterSourceRequest {
  type: "register-source";
  source: {
    id: string;
    name: string;
    width: number;
    height: number;
    file: Blob;
  };
}

export interface RemoveSourceRequest {
  type: "remove-source";
  id: string;
}

export type WorkerRequest = GenerateRequest | RegisterSourceRequest | RemoveSourceRequest;

export interface GenerateResponse {
  type: "result";
  id: number;
  result: GenerateResult;
}

export interface GenerateError {
  type: "error";
  id: number;
  message: string;
}

export interface GenerateProgress {
  type: "progress";
  id: number;
  completed: number;
  total: number;
}

export type WorkerResponse = GenerateResponse | GenerateError | GenerateProgress;
