import { encodeReport } from "@ns2-studio/protocol";
import type { PadReport } from "@ns2-studio/pad-types";
import type { SerialPortLike } from "./types";

type QueueItem =
  | { kind: "report"; report: PadReport }
  | { kind: "cmd"; bytes: Uint8Array };

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Single-writer queue for the serial port.
 *
 * - Writes are spaced at least `minIntervalMs` (default 2) apart.
 * - Reports are coalesced to the newest pending one ("只发最新"): enqueues
 *   within the same tick collapse into one write, and reports that arrive
 *   while a write is in-flight replace the pending slot.
 * - Commands keep FIFO order and are never coalesced.
 *
 * The pump is deferred to a microtask so synchronous report bursts merge
 * before anything hits the wire.
 */
export class ReportWriter {
  private queue: QueueItem[] = [];
  private running = false;
  private pumpScheduled = false;
  private closed = false;
  private lastWriteAt = 0;
  private flushResolvers: Array<() => void> = [];

  constructor(
    private layer: SerialPortLike,
    private minIntervalMs: number,
    private onTx?: (bytes: Uint8Array) => void,
  ) {}

  enqueueReport(report: PadReport): void {
    if (this.closed) return;
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i]?.kind === "report") {
        this.queue[i] = { kind: "report", report };
        return;
      }
    }
    this.queue.push({ kind: "report", report });
    this.schedulePump();
  }

  enqueueCommand(bytes: Uint8Array): void {
    if (this.closed) return;
    this.queue.push({ kind: "cmd", bytes: Uint8Array.from(bytes) });
    this.schedulePump();
  }

  /** Resolves once everything enqueued so far has been written. */
  flush(): Promise<void> {
    return new Promise((resolve) => {
      this.flushResolvers.push(resolve);
      this.schedulePump();
    });
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  close(): void {
    this.closed = true;
    this.queue = [];
  }

  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (!this.closed && this.queue.length > 0) {
        const item = this.queue.shift() as QueueItem;
        const bytes =
          item.kind === "report" ? encodeReport(item.report) : item.bytes;
        await this.writeBytes(bytes);
      }
    } finally {
      this.running = false;
      const resolvers = this.flushResolvers.splice(0);
      for (const resolve of resolvers) resolve();
    }
  }

  private async writeBytes(bytes: Uint8Array): Promise<void> {
    const elapsed = Date.now() - this.lastWriteAt;
    if (this.minIntervalMs > 0 && elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed);
    }
    this.lastWriteAt = Date.now();
    this.onTx?.(bytes);
    await this.layer.write(bytes);
  }
}