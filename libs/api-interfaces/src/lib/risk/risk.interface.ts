/**
 * Risk interface representing a risk entity
 */
export interface Risk {
  id: string;
  name: string;
  description: string;
  level: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Interface for risk creation payload
 */
export interface CreateRisk {
  name: string;
  description: string;
  level: number;
}

/**
 * Interface for risk update payload
 */
export interface UpdateRisk {
  id: string;
  name?: string;
  description?: string;
  level?: number;
}
