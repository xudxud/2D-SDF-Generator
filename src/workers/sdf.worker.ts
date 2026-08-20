/// <reference lib="webworker" />

import { generateSdf } from "../core/generate";
import type { GenerateRequest, WorkerResponse } from "../core/types";

self.onmessage = (event: MessageEvent<GenerateRequest>) => {
  const request = event.data;
  if (request.type !== "generate") return;

  try {
    const result = generateSdf(request.sources, request.options, (completed, total) => {
      const response: WorkerResponse = {
        type: "progress",
        id: request.id,
        completed,
        total,
      };
      self.postMessage(response);
    });
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
