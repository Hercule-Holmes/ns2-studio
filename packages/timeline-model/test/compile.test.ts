import { describe, expect, it } from "vitest";
import { SwitchButton } from "@ns2-studio/pad-types";
import {
  compile,
  hatConflictWarnings,
  validateProject,
  type Project,
} from "../src/index";
import { ProjectValidationError } from "../src/index";

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    magic: "NSPROJ",
    version: 1,
    name: "test",
    durationMs: 200,
    gridMs: 10,
    tracks: [],
    ...overrides,
  };
}

describe("compile: 单 A clip 100–180ms @100Hz", () => {
  it("produces the expected buttons frame pattern", () => {
    const project = baseProject({
      durationMs: 180,
      tracks: [
        {
          id: "t_btn",
          type: "buttons",
          clips: [{ id: "c1", key: "A", startMs: 100, endMs: 180 }],
        },
      ],
    });
    const { frames } = compile(project, { hz: 100 });

    expect(frames).toHaveLength(19);
    for (let i = 0; i < frames.length; i++) {
      expect(frames[i]!.tUs).toBe(i * 10000);
      const tMs = i * 10;
      const expected = tMs >= 100 && tMs < 180 ? SwitchButton.A : 0;
      expect(frames[i]!.buttons, `frame @${tMs}ms`).toBe(expected);
      expect(frames[i]!.hat).toBe(8);
    }
  });
});

describe("compile: 两键重叠", () => {
  it("bit-ORs overlapping button clips", () => {
    const project = baseProject({
      durationMs: 200,
      tracks: [
        {
          id: "t_btn",
          type: "buttons",
          clips: [
            { id: "c1", key: "A", startMs: 50, endMs: 150 },
            { id: "c2", key: "B", startMs: 100, endMs: 200 },
          ],
        },
      ],
    });
    const { frames } = compile(project, { hz: 100 });

    const A = SwitchButton.A;
    const B = SwitchButton.B;
    for (let i = 0; i < frames.length; i++) {
      const tMs = i * 10;
      let expected = 0;
      if (tMs >= 50 && tMs < 150) expected |= A;
      if (tMs >= 100 && tMs < 200) expected |= B;
      expect(frames[i]!.buttons, `frame @${tMs}ms`).toBe(expected);
    }
    expect(frames[5]!.buttons).toBe(A);
    expect(frames[12]!.buttons).toBe(A | B);
    expect(frames[16]!.buttons).toBe(B);
  });
});

describe("compile: stick 从中心到上", () => {
  it("linearly interpolates the L stick from center to top", () => {
    const project = baseProject({
      durationMs: 500,
      tracks: [
        {
          id: "t_ls",
          type: "stick",
          stick: "L",
          clips: [
            {
              id: "c2",
              startMs: 0,
              endMs: 600,
              keyframes: [
                { offsetMs: 0, x: 128, y: 128 },
                { offsetMs: 500, x: 128, y: 0 },
              ],
            },
          ],
        },
      ],
    });
    const { frames } = compile(project, { hz: 100 });

    expect(frames[0]!.lx).toBe(128);
    expect(frames[0]!.ly).toBe(128);
    expect(frames[25]!.lx).toBe(128);
    expect(frames[25]!.ly).toBe(64);
    expect(frames[50]!.lx).toBe(128);
    expect(frames[50]!.ly).toBe(0);
  });
});

describe("compile: hat 区间 + 后写覆盖", () => {
  it("sets hat inside the interval and later clips win on conflict", () => {
    const project = baseProject({
      durationMs: 100,
      tracks: [
        {
          id: "t_hat1",
          type: "hat",
          clips: [{ id: "h1", startMs: 0, endMs: 100, hat: 2 }],
        },
        {
          id: "t_hat2",
          type: "hat",
          clips: [{ id: "h2", startMs: 20, endMs: 60, hat: 6 }],
        },
      ],
    });
    const { frames } = compile(project, { hz: 100 });
    for (let i = 0; i < frames.length; i++) {
      const tMs = i * 10;
      const expected = tMs >= 20 && tMs < 60 ? 6 : tMs < 100 ? 2 : 8;
      expect(frames[i]!.hat, `frame @${tMs}ms`).toBe(expected);
    }
  });

  it("reports hat overlaps as warnings (not errors)", () => {
    const project = baseProject({
      tracks: [
        { id: "a", type: "hat", clips: [{ id: "h1", startMs: 0, endMs: 50, hat: 2 }] },
        { id: "b", type: "hat", clips: [{ id: "h2", startMs: 30, endMs: 80, hat: 4 }] },
      ],
    });
    expect(hatConflictWarnings(project)).toContain("hat clips h1 and h2 overlap");
  });
});

describe("compile: amiibo 旁路事件", () => {
  it("emits AmiiboEvents and does not touch frames", () => {
    const project = baseProject({
      durationMs: 1000,
      tracks: [
        {
          id: "t_ami",
          type: "amiibo",
          clips: [{ id: "c4", startMs: 800, endMs: 801, slot: 0 }],
        },
      ],
    });
    const { frames, amiiboEvents } = compile(project, { hz: 100 });
    expect(amiiboEvents).toEqual([{ tUs: 800000, slot: 0 }]);
    for (const f of frames) {
      expect(f.buttons).toBe(0);
      expect(f.hat).toBe(8);
    }
  });
});

describe("validateProject: 非法工程抛错信息稳定", () => {
  const expectError = (p: unknown, code: string, re: RegExp) => {
    let caught: unknown = null;
    try {
      validateProject(p);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProjectValidationError);
    const err = caught as ProjectValidationError;
    expect(err.code).toBe(code);
    expect(err.message).toMatch(re);
  };

  it("rejects time inversion (endMs < startMs)", () => {
    expectError(
      baseProject({
        tracks: [
          { id: "t", type: "buttons", clips: [{ id: "c1", key: "A", startMs: 180, endMs: 100 }] },
        ],
      }),
      "clip.time.inversion",
      /endMs 100 < startMs 180/,
    );
  });

  it("rejects unknown button key", () => {
    expectError(
      baseProject({
        tracks: [
          { id: "t", type: "buttons", clips: [{ id: "c1", key: "NOT_A_KEY", startMs: 0, endMs: 10 }] },
        ],
      }),
      "clip.unknown.key",
      /unknown button key "NOT_A_KEY"/,
    );
  });

  it("rejects duplicate track id", () => {
    expectError(
      baseProject({
        tracks: [
          { id: "t", type: "marker", clips: [] },
          { id: "t", type: "marker", clips: [] },
        ],
      }),
      "track.id.conflict",
      /duplicate track id "t"/,
    );
  });

  it("rejects duplicate clip id across tracks", () => {
    expectError(
      baseProject({
        tracks: [
          { id: "a", type: "marker", clips: [{ id: "c", startMs: 0, endMs: 0, label: "x" }] },
          { id: "b", type: "marker", clips: [{ id: "c", startMs: 0, endMs: 0, label: "y" }] },
        ],
      }),
      "clip.id.conflict",
      /duplicate clip id "c"/,
    );
  });

  it("rejects bad magic / version", () => {
    expectError({ ...baseProject(), magic: "NOPE" }, "project.magic", /magic/);
    expectError({ ...baseProject(), version: 99 }, "project.version", /version/);
  });

  it("rejects unknown track type", () => {
    expectError(
      { ...baseProject(), tracks: [{ id: "t", type: "garbage", clips: [] }] },
      "track.type",
      /unknown type "garbage"/,
    );
  });

  it("rejects out-of-range hat", () => {
    expectError(
      baseProject({
        tracks: [{ id: "t", type: "hat", clips: [{ id: "h", startMs: 0, endMs: 10, hat: 9 }] }],
      }),
      "clip.hat.range",
      /hat must be an integer 0-8/,
    );
  });

  it("rejects non-ascending stick keyframes", () => {
    expectError(
      baseProject({
        tracks: [
          {
            id: "t",
            type: "stick",
            stick: "L",
            clips: [
              { id: "s", startMs: 0, endMs: 100, keyframes: [
                { offsetMs: 50, x: 128, y: 128 },
                { offsetMs: 10, x: 0, y: 0 },
              ] },
            ],
          },
        ],
      }),
      "clip.keyframe.order",
      /strictly increasing/,
    );
  });
});