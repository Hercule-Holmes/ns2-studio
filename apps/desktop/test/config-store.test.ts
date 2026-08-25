import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigStore,
  DEFAULT_APP_CONFIG,
} from "../src/main/config/config-store";
import { FileLogger } from "../src/main/log/file-logger";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "ns2-config-"));
}

describe("ConfigStore (AppConfig §6)", () => {
  it("returns defaults when the file is missing", () => {
    const store = new ConfigStore(join(tempDir(), "config.json"));
    expect(store.get()).toEqual(DEFAULT_APP_CONFIG);
  });

  it("deep-merges partial updates without dropping siblings", () => {
    const store = new ConfigStore(join(tempDir(), "config.json"));
    store.update({ serial: { minIntervalMs: 5 } });
    const cfg = store.get();
    expect(cfg.serial.minIntervalMs).toBe(5);
    expect(cfg.serial.baud).toBe(DEFAULT_APP_CONFIG.serial.baud);
    expect(cfg.capture).toEqual(DEFAULT_APP_CONFIG.capture);
    expect(cfg.timeline).toEqual(DEFAULT_APP_CONFIG.timeline);
  });

  it("persists to disk and reloads on a fresh instance", () => {
    const file = join(tempDir(), "config.json");
    const store = new ConfigStore(file);
    store.update({
      capture: { swapABXY: true, triggerThreshold: 200 },
      timeline: { gridMs: 25 },
    });

    const reloaded = new ConfigStore(file);
    expect(reloaded.get().capture.swapABXY).toBe(true);
    expect(reloaded.get().capture.triggerThreshold).toBe(200);
    expect(reloaded.get().timeline.gridMs).toBe(25);
  });

  it("survives a corrupt file (falls back to defaults)", () => {
    const file = join(tempDir(), "config.json");
    writeFileSync(file, "{ not json", "utf8");
    const store = new ConfigStore(file);
    expect(store.get()).toEqual(DEFAULT_APP_CONFIG);
  });

  it("writes pretty-printed JSON on disk", () => {
    const file = join(tempDir(), "config.json");
    new ConfigStore(file).update({ ui: { theme: "light" } });
    const raw = readFileSync(file, "utf8");
    expect(raw).toContain('"ui"');
    expect(JSON.parse(raw).ui.theme).toBe("light");
  });
});

describe("FileLogger", () => {
  it("writes main log and crash blocks under userData/logs", () => {
    const dir = tempDir();
    const logger = new FileLogger(dir);
    logger.log("info", "hello");
    logger.crash("uncaughtException", "boom\nat x");

    const main = readFileSync(join(dir, "logs", "main.log"), "utf8");
    expect(main).toContain("[info] hello");

    const crash = readFileSync(join(dir, "logs", "crash.log"), "utf8");
    expect(crash).toContain("uncaughtException");
    expect(crash).toContain("boom");
    expect(crash).toContain("at x");
  });

  it("does not throw when the base dir is cleaned up mid-run", () => {
    const dir = tempDir();
    const logger = new FileLogger(join(dir, "gone"));
    rmSync(dir, { recursive: true, force: true });
    expect(() => logger.log("info", "x")).not.toThrow();
    expect(() => logger.crash("x", "y")).not.toThrow();
  });
});