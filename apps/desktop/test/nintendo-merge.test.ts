import { describe, expect, it } from "vitest";
import { mergeDaily, filterRange } from "../src/main/nintendo/merge";
import type { NintendoStoredDaily } from "../src/main/nintendo/account-store";

function row(
  sub: string,
  date: string,
  apps: Array<{ id: string; name: string; seconds: number }>,
): NintendoStoredDaily & { sub: string } {
  return {
    sub,
    date,
    updatedAt: date + "-cursor",
    device: "Switch",
    apps: apps.map((a) => ({
      id: a.id,
      name: a.name,
      imageUri: "",
      totalSeconds: a.seconds,
      sessions: [],
    })),
    totalSeconds: apps.reduce((acc, a) => acc + a.seconds, 0),
  };
}

describe("mergeDaily (S19 合并语义 = 求和)", () => {
  it("sums the same game across accounts on the same day", () => {
    const days = mergeDaily([
      row("A", "2026-01-01", [{ id: "zelda", name: "旷野之息", seconds: 3600 }]),
      row("B", "2026-01-01", [{ id: "zelda", name: "旷野之息", seconds: 1800 }]),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0]!.totalSeconds).toBe(5400);
    expect(days[0]!.apps[0]!.totalSeconds).toBe(5400);
    expect(days[0]!.apps[0]!.perAccount).toEqual({ A: 3600, B: 1800 });
  });

  it("keeps different games as separate rows", () => {
    const days = mergeDaily([
      row("A", "2026-01-01", [{ id: "zelda", name: "Z", seconds: 600 }]),
      row("B", "2026-01-01", [{ id: "mario", name: "M", seconds: 300 }]),
    ]);
    expect(days[0]!.apps).toHaveLength(2);
    expect(days[0]!.apps.map((a) => a.id).sort()).toEqual(["mario", "zelda"]);
  });

  it("sorts days descending", () => {
    const days = mergeDaily([
      row("A", "2026-01-01", [{ id: "x", name: "X", seconds: 60 }]),
      row("A", "2026-01-02", [{ id: "x", name: "X", seconds: 120 }]),
    ]);
    expect(days.map((d) => d.date)).toEqual(["2026-01-02", "2026-01-01"]);
  });

  it("respects account filtering upstream (rows already filtered)", () => {
    const days = mergeDaily([row("A", "2026-01-01", [{ id: "x", name: "X", seconds: 90 }])]);
    expect(days[0]!.perAccount).toEqual({ A: 90 });
  });
});

describe("filterRange", () => {
  const days = mergeDaily([
    row("A", "2026-01-01", [{ id: "x", name: "X", seconds: 10 }]),
    row("A", "2026-01-15", [{ id: "x", name: "X", seconds: 20 }]),
    row("A", "2026-02-01", [{ id: "x", name: "X", seconds: 30 }]),
  ]);

  it("filters by inclusive range (days stay desc-sorted)", () => {
    const picked = filterRange(days, "2026-01-01", "2026-01-31");
    expect(picked.map((d) => d.date)).toEqual(["2026-01-15", "2026-01-01"]);
  });

  it("returns everything without bounds", () => {
    expect(filterRange(days).length).toBe(3);
  });
});
