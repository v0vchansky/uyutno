export class AppError extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 400);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code?: string) {
    super(message, 409, code);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429);
  }
}
