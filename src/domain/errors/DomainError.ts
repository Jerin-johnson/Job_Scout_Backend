/**
 * Base abstract class for all domain-level exceptions in Clean Architecture.
 * Inherits from standard Error while carrying HTTP status code and error code semantics.
 */
export abstract class DomainError extends Error {
  public abstract readonly code: string;
  public abstract readonly statusCode: number;

  constructor(message: string, public readonly details?: unknown) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      statusCode: this.statusCode,
      message: this.message,
      details: this.details,
    };
  }
}

export class EntityNotFoundError extends DomainError {
  public readonly code = "NOT_FOUND";
  public readonly statusCode = 404;

  constructor(entityName: string, id?: string | number, details?: unknown) {
    super(id ? `${entityName} with identifier '${id}' was not found.` : `${entityName} not found.`, details);
  }
}

export class EntityConflictError extends DomainError {
  public readonly code = "CONFLICT";
  public readonly statusCode = 409;

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

export class DomainValidationError extends DomainError {
  public readonly code = "VALIDATION_ERROR";
  public readonly statusCode = 400;

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}

export class InvalidStateTransitionError extends DomainError {
  public readonly code = "INVALID_STATE_TRANSITION";
  public readonly statusCode = 400;

  constructor(message: string, details?: unknown) {
    super(message, details);
  }
}
