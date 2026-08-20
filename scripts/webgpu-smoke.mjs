import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const chromePath =
  process.env.CHROME_PATH ??
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find(existsSync);
if (!chromePath) throw new Error("Chrome was not found. Set CHROME_PATH to run the WebGPU smoke test.");
const server = spawn(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1"], {
  cwd: root,
  stdio: "ignore",
});

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:1420");
      if (response.ok) return;
    } catch {
      // Vite has not started yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("Vite did not start.");
}

try {
  await waitForServer();
  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: process.env.WEBGPU_HEADLESS === "1",
    args: ["--enable-unsafe-webgpu"],
  });
  const page = await browser.newPage();
  const pageErrors = [];
  const run4k = process.env.WEBGPU_4K === "1";
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("http://127.0.0.1:1420", { waitUntil: "domcontentloaded" });
  const sourcePaths = Array.from({ length: run4k ? 8 : 2 }, (_, index) =>
    resolve(root, `legacy/unity-editor/images/Demo/face_${String(index + 1).padStart(2, "0")}.png`),
  );
  await page.setInputFiles('input[type="file"]', sourcePaths);
  await page.getByText(`${sourcePaths.length} MASKS`).waitFor();
  if (run4k) {
    await page.locator(".field-grid input").nth(0).fill("4096");
    await page.locator(".field-grid input").nth(1).fill("4096");
  }
  await page.selectOption("select", "gpu");
  const startedAt = performance.now();
  await page.getByRole("button", { name: "GENERATE FIELD" }).click();
  await page.getByRole("button", { name: "GENERATE FIELD" }).waitFor({ timeout: 120_000 });
  const elapsed = performance.now() - startedAt;

  const status = await page.locator(".preview-meta").innerText();
  const notice = await page.locator(".notice").allTextContents();
  if (pageErrors.length) throw new Error(pageErrors.join("\n"));
  if (!status.includes("WEBGPU JFA+2")) {
    throw new Error(`GPU smoke test fell back to CPU: ${notice.join(" ")}`);
  }

  console.log(`${status.replaceAll("\n", " / ")} in ${(elapsed / 1000).toFixed(2)}s`);
  if (notice.length) console.log(notice.join(" "));
  if (!run4k && status.includes("WEBGPU JFA+2")) {
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      window.__gpuPixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    });
    await page.selectOption("select", "exact");
    const exactStartedAt = performance.now();
    await page.getByRole("button", { name: "GENERATE FIELD" }).click();
    await page.getByRole("button", { name: "GENERATE FIELD" }).waitFor({ timeout: 120_000 });
    const exactElapsed = performance.now() - exactStartedAt;
    const quality = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const exact = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let changed = 0;
      let totalError = 0;
      let maxError = 0;
      for (let offset = 0; offset < exact.length; offset += 4) {
        const error = Math.abs(exact[offset] - window.__gpuPixels[offset]);
        if (error) changed++;
        totalError += error;
        maxError = Math.max(maxError, error);
      }
      return { changed, meanError: totalError / (exact.length / 4), maxError };
    });
    console.log(`Exact CPU comparison run: ${(exactElapsed / 1000).toFixed(2)}s`);
    console.log(`GPU comparison: ${quality.changed} changed pixels, mean byte error ${quality.meanError.toFixed(3)}, max ${quality.maxError}`);
  }
  await browser.close();
} finally {
  server.kill();
}
