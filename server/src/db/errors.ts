export class IdempotencyError extends Error {
  constructor(message = "Record already exists") {
    super(message);
    this.name = "IdempotencyError";
  }
}

export class LicenseNotFoundError extends Error {
  constructor(message = "License not found") {
    super(message);
    this.name = "LicenseNotFoundError";
  }
}
