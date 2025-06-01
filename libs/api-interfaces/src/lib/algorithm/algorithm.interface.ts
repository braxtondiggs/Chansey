export interface Algorithm {
  id: string;
  name: string;
  slug: string;
  service: string;
  description?: string;
  status: boolean;
  evaluate: boolean;
  weight?: number;
  cron: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAlgorithmDto {
  name: string;
  description?: string;
  status?: boolean;
  evaluate?: boolean;
  weight?: number;
  cron?: string;
}

export interface UpdateAlgorithmDto {
  id: string;
  name?: string;
  description?: string;
  status?: boolean;
  evaluate?: boolean;
  weight?: number;
  cron?: string;
}
