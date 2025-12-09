/**
 * Strategy configuration interface
 * Represents a variation/configuration of an existing algorithm for automated evaluation
 */

export enum StrategyStatus {
  DRAFT = 'draft',
  TESTING = 'testing',
  VALIDATED = 'validated',
  LIVE = 'live',
  DEPRECATED = 'deprecated',
  FAILED = 'failed',
  REJECTED = 'rejected',
  DEACTIVATED = 'deactivated'
}

export interface StrategyConfig {
  id: string;
  name: string;
  algorithmId: string; // Foreign key to Algorithm entity
  parameters: Record<string, any>; // Strategy-specific parameters that override algorithm defaults
  version: string;
  status: StrategyStatus;
  parentId?: string | null; // Reference to parent strategy for version tracking
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateStrategyConfigDto {
  name: string;
  algorithmId: string;
  parameters: Record<string, any>;
  version?: string;
  parentId?: string;
}

export interface UpdateStrategyConfigDto {
  name?: string;
  parameters?: Record<string, any>;
  version?: string;
  status?: StrategyStatus;
}

export interface StrategyConfigListFilters {
  status?: StrategyStatus | StrategyStatus[];
  algorithmId?: string;
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'name';
  sortOrder?: 'ASC' | 'DESC';
}
