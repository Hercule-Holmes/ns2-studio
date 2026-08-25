import { describe, expect, it } from "vitest";
import { parseRecording, serializeRecording } from "../src/shared/nsrec";
import type { Recording } from "@ns2-studio/timeline-model";

function sample(): Recording {
  return {
    magic: "NSREC",
    version: 1,
    meta: {
      createdAt: "2026-08-22T00:00:00.000Z",
      source: "manual",
      deviceName: "NS2 Pro",
      tickHz: 250,
    },
    frames: [
      { tUs: 0, buttons: 0, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
      { tUs: 4000, buttons: 4, hat: 8, lx: 128, ly: 128, rx: 128, ry: 128 },
    ],
  };
}

describe("nsrec serialize/parse", () => {
  it("round-trips a recording", () => {
    const rec = sample();
    expect(parseRecording(serializeRecording(rec))).toEqual(rec);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseRecording("{not json")).toThrow(/JSON 解析失败/);
  });

  it("rejects a non-object root", () => {
    expect(() => parseRecording("[1, 2]")).toThrow(/对象/);
  });

  it("rejects a wrong magic", () => {
    expect(() =>
      parseRecording(JSON.stringify({ ...sample(), magic: "NSPROJ" })),
    ).toThrow(/NSREC/);
  });

  it("rejects an unknown version", () => {
    expect(() =>
      parseRecording(JSON.stringify({ ...sample(), version: 2 })),
    ).toThrow(/version/);
  });

  it("rejects missing frames", () => {
    const { frames, ...rest } = sample();
    expect(() => parseRecording(JSON.stringify(rest))).toThrow(/frames/);
  });

  it("rejects non-numeric tUs", () => {
    const rec = sample();
    rec.frames = [{ ...rec.frames[0]!, tUs: "bad" as unknown as number }];
    expect(() => parseRecording(JSON.stringify(rec))).toThrow(/tUs/);
  });

  it("rejects out-of-order tUs", () => {
    const rec = sample();
    rec.frames = [rec.frames[1]!, rec.frames[0]!];
    expect(() => parseRecording(JSON.stringify(rec))).toThrow(/非递减/);
  });
});