/**
 * nsrec (.nsrec.json) serialization / parsing (S7). Format contract lives in
 * docs/architecture/03-DATA-MODELS.md §3. Pure functions, no electron/fs, so
 * both main and renderer can use them for save/load/replay.
 */
import { RECORDING_MAGIC, RECORDING_VERSION } from "@ns2-studio/timeline-model";
import type { Recording } from "@ns2-studio/timeline-model";

export function serializeRecording(rec: Recording): string {
  return JSON.stringify(rec, null, 2);
}

/**
 * Parse + validate raw nsrec text. Throws a readable Error on any contract
 * violation (magic / version / frames ordering) so the caller can surface it.
 */
export function parseRecording(text: string): Recording {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `nsrec JSON 解析失败：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("nsrec 必须是 JSON 对象");
  }
  const rec = parsed as Partial<Recording>;
  if (rec.magic !== RECORDING_MAGIC) {
    throw new Error(`nsrec magic 必须为 "${RECORDING_MAGIC}"`);
  }
  if (rec.version !== RECORDING_VERSION) {
    throw new Error(`nsrec version 必须为 ${RECORDING_VERSION}`);
  }
  if (rec.meta === null || typeof rec.meta !== "object") {
    throw new Error("nsrec meta 缺失");
  }
  if (!Array.isArray(rec.frames)) {
    throw new Error("nsrec frames 必须是数组");
  }
  let prevTUs = -Infinity;
  for (const frame of rec.frames) {
    if (typeof frame.tUs !== "number" || !Number.isFinite(frame.tUs)) {
      throw new Error("nsrec frame tUs 必须是非负数字");
    }
    if (frame.tUs < prevTUs) {
      throw new Error("nsrec frames tUs 必须严格非递减");
    }
    prevTUs = frame.tUs;
  }
  return rec as Recording;
}