/**
 * Shared Type Definitions for JobScout Backend Clean Architecture
 */

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;

export interface IBaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPaginationOptions {
  page?: number;
  limit?: number;
}

export interface IPaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
}
