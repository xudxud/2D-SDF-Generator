import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { GenerateOptions, GenerateRequest, GenerateResult, WorkerResponse } from "./core/types";
import { loadImageFile, savePng, type LoadedImage } from "./lib/images";

const DEFAULT_OPTIONS: GenerateOptions = {
  width: 512,
  height: 512,
  pxRange: 64,
  threshold: 0.5,
  channel: "luminance",
  invert: false,
  algorithm: "exact",
  posterizeSteps: 0,
};

const SOURCE_URL = "https://github.com/xudxud/2D-SDF-Generator";

function App() {
  const [sources, setSources] = useState<LoadedImage[]>([]);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const worker = new Worker(new URL("./workers/sdf.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.id !== requestId.current) return;
      if (message.type === "progress") {
        setProgress(message.completed / message.total);
      } else if (message.type === "result") {
        setResult(message.result);
        setBusy(false);
        setProgress(1);
      } else {
        setError(message.message);
        setBusy(false);
      }
    };
    return () => worker.terminate();
  }, []);

  useEffect(() => {
    const preventWindowDrop = (event: globalThis.DragEvent) => event.preventDefault();
    window.addEventListener("dragover", preventWindowDrop);
    window.addEventListener("drop", preventWindowDrop);
    return () => {
      window.removeEventListener("dragover", preventWindowDrop);
      window.removeEventListener("drop", preventWindowDrop);
    };
  }, []);

  useEffect(() => {
    if (!result || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = result.width;
    canvas.height = result.height;
    const context = canvas.getContext("2d");
    const displayPixels = new Uint8ClampedArray(result.pixels);
    context?.putImageData(new ImageData(displayPixels, result.width, result.height), 0, 0);
  }, [result]);

  const addFiles = async (files: FileList | File[]) => {
    setError("");
    try {
      const loaded = await Promise.all(Array.from(files).map(loadImageFile));
      setSources((current) => {
        if (current.length === 0 && loaded[0]) {
          setOptions((value) => ({
            ...value,
            width: loaded[0].width,
            height: loaded[0].height,
          }));
        }
        return [...current, ...loaded];
      });
      setResult(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the selected images.");
    }
  };

  const removeSource = (index: number) => {
    setSources((current) => {
      URL.revokeObjectURL(current[index].url);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
    setResult(null);
  };

  const moveSource = (index: number, direction: -1 | 1) => {
    setSources((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setResult(null);
  };

  const generate = () => {
    if (!workerRef.current || sources.length === 0) return;
    setBusy(true);
    setError("");
    setProgress(0);
    const id = ++requestId.current;
    const request: GenerateRequest = {
      type: "generate",
      id,
      sources: sources.map(({ name, width, height, rgba }) => ({ name, width, height, rgba })),
      options,
    };
    workerRef.current.postMessage(request);
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) void savePng(blob, "sdf-output.png");
    }, "image/png");
  };

  const openSource = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    event.preventDefault();
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(SOURCE_URL);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open the source URL.");
    }
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) void addFiles(event.dataTransfer.files);
  };

  return (
    <main>
      <section className="workspace">
        <aside className="panel controls-panel">
          <div className="panel-title"><span>01</span> INPUT MASKS</div>
          <div className="order-guide">
            <strong>MULTI-MASK ORDER</strong>
            <p><b>TOP</b> Smallest white area</p>
            <i>↓</i>
            <p><b>BOTTOM</b> Largest white area</p>
            <small>The list order is the calculation order. Use the arrows to rearrange masks.</small>
          </div>
          <label
            className={`drop-zone ${dragging ? "is-dragging" : ""}`}
            onDragEnter={() => setDragging(true)}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={onDrop}
          >
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <strong>DROP MASKS HERE</strong>
            <span>or click to browse / PNG, JPG, WEBP</span>
          </label>

          <div className="source-list">
            {sources.map((source, index) => (
              <article className="source-item" key={source.id}>
                <img src={source.url} alt="" />
                <div><b>{String(index + 1).padStart(2, "0")}</b><strong>{source.name}</strong><small>{source.width} x {source.height}</small></div>
                <div className="source-actions">
                  <button onClick={() => moveSource(index, -1)} disabled={index === 0} aria-label="Move up">↑</button>
                  <button onClick={() => moveSource(index, 1)} disabled={index === sources.length - 1} aria-label="Move down">↓</button>
                  <button onClick={() => removeSource(index)} aria-label="Remove">×</button>
                </div>
              </article>
            ))}
          </div>
        </aside>

        <section className="panel preview-panel">
          <div className="panel-title"><span>02</span> FIELD PREVIEW</div>
          <div className="preview-stage">
            {result ? <canvas ref={canvasRef} /> : <div className="empty-preview"><span>SDF</span><p>NO FIELD GENERATED</p></div>}
            <div className="ruler ruler-x" />
            <div className="ruler ruler-y" />
          </div>
          <div className="preview-meta">
            <span>{options.width} x {options.height} PX</span>
            <span>{options.algorithm === "exact" ? "EXACT EDT" : "8-NEIGHBOR CHAMFER"}</span>
            <span>{sources.length} LAYER{sources.length === 1 ? "" : "S"}</span>
          </div>
          {result && result.conflictPixels > 0 && <p className="warning">{result.conflictPixels.toLocaleString()} non-nested layer conflicts detected.</p>}
        </section>

        <aside className="panel settings-panel">
          <div className="panel-title"><span>03</span> PARAMETERS</div>
          <div className="field-grid two-cols">
            <label>WIDTH<input type="number" min="1" max="8192" value={options.width} onChange={(e) => setOptions({ ...options, width: Number(e.target.value) })} /></label>
            <label>HEIGHT<input type="number" min="1" max="8192" value={options.height} onChange={(e) => setOptions({ ...options, height: Number(e.target.value) })} /></label>
          </div>
          <label className="control-label">ALGORITHM<select value={options.algorithm} onChange={(e) => setOptions({ ...options, algorithm: e.target.value as GenerateOptions["algorithm"] })}><option value="exact">Exact Euclidean</option><option value="chamfer">Legacy Chamfer</option></select></label>
          <label className="control-label">MASK CHANNEL<select value={options.channel} onChange={(e) => setOptions({ ...options, channel: e.target.value as GenerateOptions["channel"] })}><option value="luminance">Luminance</option><option value="alpha">Alpha</option><option value="red">Red</option></select></label>
          <label className="range-label"><span>THRESHOLD <output>{options.threshold.toFixed(2)}</output></span><input type="range" min="0" max="1" step="0.01" value={options.threshold} onChange={(e) => setOptions({ ...options, threshold: Number(e.target.value) })} /></label>
          <label className="range-label"><span>PIXEL RANGE <output>{options.pxRange}</output></span><input type="range" min="1" max="256" value={options.pxRange} onChange={(e) => setOptions({ ...options, pxRange: Number(e.target.value) })} /></label>
          <label className="control-label">POSTERIZE LEVELS<input type="number" min="0" max="256" value={options.posterizeSteps} onChange={(e) => setOptions({ ...options, posterizeSteps: Number(e.target.value) })} /><small>0 keeps the field continuous.</small></label>
          <label className="toggle"><input type="checkbox" checked={options.invert} onChange={(e) => setOptions({ ...options, invert: e.target.checked })} /><span /> INVERT MASK</label>

          {error && <p className="error">{error}</p>}
          <button className="generate-button" onClick={generate} disabled={busy || sources.length === 0}>
            <span>{busy ? `PROCESSING ${Math.round(progress * 100)}%` : "GENERATE FIELD"}</span><b>→</b>
          </button>
          <button className="download-button" onClick={download} disabled={!result}>EXPORT PNG</button>
        </aside>
      </section>

      <footer>
        <span>
          v{__APP_VERSION__} / <a href={SOURCE_URL} target="_blank" rel="noreferrer" onClick={openSource}>SOURCE ↗</a>
        </span>
      </footer>
    </main>
  );
}

export default App;
