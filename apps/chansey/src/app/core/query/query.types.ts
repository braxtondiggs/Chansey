import { CreateMutationResult, CreateQueryResult } from '@tanstack/angular-query-experimental';

export type Query<TData> = CreateQueryResult<TData, Error>;

export type Mutation<TData = unknown, TVariables = unknown> = CreateMutationResult<TData, Error, TVariables>;

export interface ApiResponse {
  message: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
