export class IdempotencyError extends Error {
  constructor(message = "Record already exists") {
    super(message);
    this.name = "IdempotencyError";
  }
}
