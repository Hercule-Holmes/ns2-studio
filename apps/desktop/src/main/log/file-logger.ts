import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Main-process crash / diagnostic log written under `userData/logs/`.
 * Renderer errors are forwarded over IPC (`log:error`) and appended here too.
 */
export class FileLogger {
  private readonly dir: string;
  private readonly crashPath: string;

  constructor(userData: string) {
    this.dir = join(userData, "logs");
    this.crashPath = join(this.dir, "crash.log");
  }

  /** Append a line to `userData/logs/main.log`. */
  log(scope: string, message: string): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      const line = `${new Date().toISOString()} [${scope}] ${message}\n`;
      appendFileSync(join(this.dir, "main.log"), line, "utf8");
    } catch {
      /* best-effort */
    }
  }

  /** Append a crash record (error stack / event detail) to crash.log. */
  crash(kind: string, detail: string): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      const block =
        `\n=== ${new Date().toISOString()} ${kind} ===\n${detail}\n`;
      appendFileSync(this.crashPath, block, "utf8");
    } catch {
      /* best-effort */
    }
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.message}\n${err.stack ?? ""}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}