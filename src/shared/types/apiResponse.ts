/**
 * Common API Response Models matching production contracts in docs/api-contracts.md.
 */

export interface ApiPaginationMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
  [key: string]: unknown;
}

export interface ApiSuccessResponse<T> {
  data: T;
  meta?: ApiPaginationMeta;
}

export interface ApiValidationErrorDetail {
  path: string;
  message: string;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: ApiValidationErrorDetail[] | unknown;
  requestId: string;
}

export interface ApiErrorResponse {
  error: ApiErrorPayload;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export function successResponse<T>(data: T, meta?: ApiPaginationMeta): ApiSuccessResponse<T> {
  if (meta) {
    return { data, meta };
  }
  return { data };
}

export function errorResponse(
  code: string,
  message: string,
  requestId: string = "req_unknown",
  details?: unknown,
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details !== undefined ? { details } : {}),
    },
  };
}
