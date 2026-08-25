import {
  Reply,
  SAVE_AMIIBO_PACKET_SIZE,
  buildChangeAmiiboIndexFrame,
  buildSaveAmiiboMetaFrame,
  commands,
} from "@ns2-studio/protocol";
import type { DeviceService } from "../device/device-service";
import { AmiiboError } from "./errors";

export interface SaveAmiiboOptions {
  chunkSize?: number;
  ackTimeoutMs?: number;
  resetTimeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
  onProgress?: (p: { slot: number; sent: number; total: number }) => void;
}

export interface SaveAmiiboResult {
  ok: boolean;
  slot: number;
  sent: number;
  total: number;
}

type ReplyOutcome = "ack" | "error" | "busy" | "timeout";

const RESET_ATTEMPTS = 3;

/**
 * Protocol-level amiibo device operations, aligned with EasyCon
 * `NintendoSwitchCmd.SaveAmiibo` / `ChangeAmiiboIndex`:
 *
 * - saveToSlot sends each 20B chunk as a header frame, waits for Ack, sends the
 *   raw body, waits for Ack again; any missing Ack triggers a Hello handshake
 *   reset then retries the same chunk.
 * - changeIndex sends the 3-byte change frame and waits for Ack.
 */
export class AmiiboDeviceApi {
  constructor(private readonly device: DeviceService) {}

  async saveToSlot(
    slot: number,
    bytes: Uint8Array,
    opts: SaveAmiiboOptions = {},
  ): Promise<SaveAmiiboResult> {
    const chunkSize = opts.chunkSize ?? SAVE_AMIIBO_PACKET_SIZE;
    const ackTimeoutMs = opts.ackTimeoutMs ?? 1000;
    const resetTimeoutMs = opts.resetTimeoutMs ?? 100;
    const maxRetries = opts.maxRetries ?? 3;
    const total = bytes.byteLength;

    if (!this.device.isConnected) {
      throw new AmiiboError("NOT_CONNECTED", "设备未连接");
    }
    if (total === 0) {
      throw new AmiiboError("EMPTY", "Amiibo 数据为空");
    }

    for (let offset = 0; offset < total; offset += chunkSize) {
      this.throwIfCancelled(opts.signal);
      const len = Math.min(chunkSize, total - offset);
      const header = buildSaveAmiiboMetaFrame(offset, len, slot);
      const body = bytes.slice(offset, offset + len);

      let attempts = 0;
      let done = false;
      while (!done) {
        this.throwIfCancelled(opts.signal);
        attempts += 1;

        const headerOutcome = await this.sendAndWait(
          header,
          Reply.Ack,
          ackTimeoutMs,
          opts.signal,
        );
        if (headerOutcome === "error") {
          throw new AmiiboError(
            "UNSUPPORTED",
            `固件回复 Error（SaveAmiibo 头，offset=${offset}）`,
          );
        }
        if (headerOutcome === "ack") {
          const bodyOutcome = await this.sendAndWait(
            body,
            Reply.Ack,
            ackTimeoutMs,
            opts.signal,
          );
          if (bodyOutcome === "error") {
            throw new AmiiboError(
              "UNSUPPORTED",
              `固件回复 Error（SaveAmiibo body，offset=${offset}）`,
            );
          }
          if (bodyOutcome === "ack") {
            done = true;
            break;
          }
        }

        // header/body ack timeout or Busy: reset via Hello, retry same chunk.
        if (attempts >= maxRetries) {
          throw new AmiiboError(
            "TIMEOUT",
            `槽位 ${slot} 分片 offset=${offset} 无 ACK（${attempts} 次尝试后放弃）`,
          );
        }
        this.throwIfCancelled(opts.signal);
        const resetOk = await this.resetControl(resetTimeoutMs, opts.signal);
        if (!resetOk) {
          throw new AmiiboError(
            "RESET_FAILED",
            `Hello 重握手失败，无法重试 offset=${offset}`,
          );
        }
      }

      opts.onProgress?.({ slot, sent: offset + len, total });
    }

    return { ok: true, slot, sent: total, total };
  }

  async changeIndex(slot: number): Promise<void> {
    if (!this.device.isConnected) {
      throw new AmiiboError("NOT_CONNECTED", "设备未连接");
    }
    const outcome = await this.sendAndWait(
      buildChangeAmiiboIndexFrame(slot),
      Reply.Ack,
      200,
    );
    if (outcome === "error") {
      throw new AmiiboError(
        "UNSUPPORTED",
        "固件回复 Error（ChangeAmiiboIndex）",
      );
    }
    if (outcome !== "ack") {
      throw new AmiiboError("TIMEOUT", `切换槽位 ${slot} 无 ACK 应答`);
    }
  }

  /**
   * Hello handshake reset (matches EasyCon ResetControl: up to 3 Hello writes
   * until Reply.Hello arrives).
   */
  private async resetControl(
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    for (let i = 0; i < RESET_ATTEMPTS; i++) {
      this.throwIfCancelled(signal);
      const outcome = await this.sendAndWait(
        commands.hello(),
        Reply.Hello,
        timeoutMs,
        signal,
      );
      if (outcome === "ack") return true;
      if (outcome === "error" || outcome === "busy") return false;
    }
    return false;
  }

  private async sendAndWait(
    bytes: Uint8Array,
    expect: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ReplyOutcome> {
    return new Promise<ReplyOutcome>((resolve) => {
      let settled = false;
      const settle = (outcome: ReplyOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        offRx();
        resolve(outcome);
      };
      const onAbort = () => settle("timeout");
      const onData = (data: Uint8Array) => {
        const arr = Array.from(data);
        if (arr.includes(expect)) {
          settle("ack");
          return;
        }
        if (arr.includes(Reply.Error)) {
          settle("error");
          return;
        }
        if (arr.includes(Reply.Busy)) {
          settle("busy");
          return;
        }
      };
      const offRx = this.device.onRxData(onData);
      const timer = setTimeout(() => settle("timeout"), timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.device.writeCommand(bytes).catch(() => settle("timeout"));
    });
  }

  private throwIfCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) throw new AmiiboError("CANCELLED", "写入已取消");
  }
}