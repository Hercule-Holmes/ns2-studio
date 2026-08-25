export class ProjectValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProjectValidationError";
    this.code = code;
  }
}