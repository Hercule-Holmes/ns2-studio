import { ProjectValidationError } from "./errors";
import {
  PROJECT_MAGIC,
  PROJECT_VERSION,
  type Project,
} from "./types";
import { validateProject } from "./validate";

/** v1 identity 迁移占位：版本已为 1 时原样通过校验。 */
export function migrate(input: unknown): Project {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ProjectValidationError("migrate.shape", "input must be an object");
  }
  const version = (input as Record<string, unknown>).version;
  if (version !== PROJECT_VERSION) {
    throw new ProjectValidationError(
      "migrate.version",
      `cannot migrate project version ${String(version)}`,
    );
  }
  return validateProject(input);
}

export function createEmptyProject(name: string): Project {
  return {
    magic: PROJECT_MAGIC,
    version: PROJECT_VERSION,
    name,
    durationMs: 0,
    gridMs: 10,
    tracks: [],
  };
}

export function emptyProject(name: string): Project {
  return createEmptyProject(name);
}