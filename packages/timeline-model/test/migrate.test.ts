import { describe, expect, it } from "vitest";
import {
  createEmptyProject,
  emptyProject,
  migrate,
  validateProject,
} from "../src/index";

describe("migrate", () => {
  it("is an identity for v1 projects", () => {
    const project = {
      magic: "NSPROJ",
      version: 1,
      name: "x",
      durationMs: 100,
      gridMs: 10,
      tracks: [],
    };
    expect(migrate(project)).toEqual(project);
  });

  it("rejects unknown versions", () => {
    expect(() => migrate({ ...createEmptyProject("x"), version: 2 })).toThrowError(
      /cannot migrate project version 2/,
    );
  });
});

describe("createEmptyProject / emptyProject", () => {
  it("returns a valid empty project", () => {
    const p = createEmptyProject("new");
    expect(p.name).toBe("new");
    expect(p.magic).toBe("NSPROJ");
    expect(p.version).toBe(1);
    expect(p.tracks).toEqual([]);
    expect(() => validateProject(p)).not.toThrow();
    expect(emptyProject("new")).toEqual(p);
  });
});