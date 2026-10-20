/**
 * Base abstract class for application-level errors.
 * These errors carry HTTP status codes, error codes, and request-level details
 * that seamlessly map to the existing API error responses.
 */
export abstract class ApplicationError extends Error {
  public abstract readonly code: string;
  public abstract readonly statusCode: number;

  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
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

export class NotFoundError extends ApplicationError {
  public readonly code = "NOT_FOUND";
  public readonly statusCode = 404;

  constructor(message = "Resource not found", details?: unknown) {
    super(message, details);
  }
}

export class UnauthorizedError extends ApplicationError {
  public readonly code = "UNAUTHORIZED";
  public readonly statusCode = 401;

  constructor(message = "Authentication required", details?: unknown) {
    super(message, details);
  }
}

export class ForbiddenError extends ApplicationError {
  public readonly code = "FORBIDDEN";
  public readonly statusCode = 403;

  constructor(message = "Access forbidden", details?: unknown) {
    super(message, details);
  }
}

export class ConflictError extends ApplicationError {
  public readonly code = "CONFLICT";
  public readonly statusCode = 409;

  constructor(message = "Resource conflict occurred", details?: unknown) {
    super(message, details);
  }
}

export class ValidationError extends ApplicationError {
  public readonly code = "VALIDATION_ERROR";
  public readonly statusCode = 400;

  constructor(message = "Validation failed", details?: unknown) {
    super(message, details);
  }
}

export class BadRequestError extends ApplicationError {
  public readonly code = "BAD_REQUEST";
  public readonly statusCode = 400;

  constructor(message = "Bad request", details?: unknown) {
    super(message, details);
  }
}

export class QuotaExceededError extends ApplicationError {
  public readonly code = "QUOTA_EXCEEDED";
  public readonly statusCode = 429;

  constructor(message = "Rate limit or quota exceeded", details?: unknown) {
    super(message, details);
  }
}

export class EmailNotVerifiedError extends ApplicationError {
  public readonly code = "EMAIL_NOT_VERIFIED";
  public readonly statusCode = 403;

  constructor(message = "Please verify your email address to continue.", details?: unknown) {
    super(message, details);
  }
}

export class InternalServerError extends ApplicationError {
  public readonly code = "INTERNAL_SERVER_ERROR";
  public readonly statusCode = 500;

  constructor(message = "Internal server error", details?: unknown) {
    super(message, details);
  }
}
