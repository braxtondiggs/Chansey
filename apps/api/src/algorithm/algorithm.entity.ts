import { ApiProperty } from '@nestjs/swagger';

import { Expose } from 'class-transformer';
import { 
  IsNotEmpty, 
  IsNumber, 
  IsOptional, 
  IsString, 
  Matches
} from 'class-validator';
import {
  AfterInsert,
  AfterLoad,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';

import { ColumnNumericTransformer } from './../utils/transformers/columnNumeric.transformer';

/**
 * Algorithm execution status enum
 */
export enum AlgorithmStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  MAINTENANCE = 'maintenance',
  ERROR = 'error'
}

/**
 * Algorithm category enum for better organization
 */
export enum AlgorithmCategory {
  TECHNICAL = 'technical',
  FUNDAMENTAL = 'fundamental',
  SENTIMENT = 'sentiment',
  HYBRID = 'hybrid',
  CUSTOM = 'custom'
}

/**
 * Algorithm configuration interface
 */
export interface AlgorithmConfig {
  parameters?: Record<string, unknown>;
  settings?: {
    timeout?: number;
    retries?: number;
    enableLogging?: boolean;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Improved Algorithm Entity with modern features
 * 
 * Enhancements:
 * - Better type safety with enums
 * - Algorithm configuration support
 * - Performance metrics tracking
 * - Enhanced metadata
 * - Strategy pattern integration
 */
@Entity()
@Index(['status', 'evaluate'])
@Index(['category', 'status'])
@Index(['strategyId'])
export class Algorithm {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the algorithm',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @IsNotEmpty()
  @IsString()
  @Index()
  @Column({ unique: true })
  @ApiProperty({
    description: 'Name of the algorithm',
    example: 'Exponential Moving Average'
  })
  name: string;

  @ApiProperty({
    description: 'Slugified name of the algorithm',
    example: 'exponential-moving-average'
  })
  @Expose()
  slug: string;

  @IsOptional()
  @IsString()
  @Column({ nullable: true })
  @ApiProperty({
    description: 'Strategy ID that implements this algorithm',
    example: 'exponential-moving-average',
    required: false
  })
  strategyId?: string;

  @IsOptional()
  @IsString()
  @Column({ nullable: true })
  @ApiProperty({
    description: 'Legacy service name (deprecated, use strategyId)',
    example: 'ExponentialMovingAverageService',
    required: false,
    deprecated: true
  })
  service?: string;

  @Column({ nullable: true, length: 1000 })
  @ApiProperty({
    description: 'Description of the algorithm',
    example: 'Technical analysis algorithm using exponential moving averages to generate trading signals.',
    required: false
  })
  description?: string;

  @Column({
    type: 'enum',
    enum: AlgorithmCategory,
    default: AlgorithmCategory.TECHNICAL
  })
  @ApiProperty({
    description: 'Category of the algorithm',
    enum: AlgorithmCategory,
    example: AlgorithmCategory.TECHNICAL
  })
  category: AlgorithmCategory;

  @Column({
    type: 'enum',
    enum: AlgorithmStatus,
    default: AlgorithmStatus.INACTIVE
  })
  @Index()
  @ApiProperty({
    description: 'Current status of the algorithm',
    enum: AlgorithmStatus,
    example: AlgorithmStatus.ACTIVE
  })
  status: AlgorithmStatus;

  @Column({ default: true })
  @ApiProperty({
    description: 'Whether to include this algorithm in evaluations',
    example: true
  })
  evaluate: boolean;

  @IsOptional()
  @IsNumber()
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 4,
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @ApiProperty({
    description: 'Weight of the algorithm in portfolio calculations',
    example: 1.5,
    required: false
  })
  weight?: number;

  @IsString()
  @Matches(/^(\*|[0-9]+) (\*|[0-9]+) (\*|[0-9]+) (\*|[0-9]+) (\*|[0-9]+)$/)
  @Column({ default: '0 */4 * * *' }) // Every 4 hours by default
  @ApiProperty({
    description: 'Cron schedule for automatic algorithm execution',
    example: '0 */4 * * *'
  })
  cron: string;

  @Column({
    type: 'jsonb',
    nullable: true
  })
  @ApiProperty({
    description: 'Algorithm configuration and parameters',
    example: {
      parameters: {
        period: 20,
        multiplier: 2.0
      },
      settings: {
        timeout: 30000,
        retries: 3,
        enableLogging: true
      }
    },
    required: false
  })
  config?: AlgorithmConfig;

  @Column({
    type: 'jsonb',
    nullable: true
  })
  @ApiProperty({
    description: 'Performance metrics and statistics',
    example: {
      totalExecutions: 150,
      successRate: 98.5,
      averageExecutionTime: 1250,
      lastExecuted: '2024-01-15T10:30:00Z',
      errorCount: 2
    },
    required: false
  })
  metrics?: {
    totalExecutions?: number;
    successfulExecutions?: number;
    failedExecutions?: number;
    successRate?: number;
    averageExecutionTime?: number;
    lastExecuted?: string;
    lastError?: string;
    errorCount?: number;
  };

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Version of the algorithm implementation',
    example: '1.2.0',
    required: false
  })
  version?: string;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Author or creator of the algorithm',
    example: 'Trading Team',
    required: false
  })
  author?: string;

  @Column({ default: false })
  @ApiProperty({
    description: 'Whether this algorithm is marked as a favorite',
    example: false
  })
  isFavorite: boolean;

  @CreateDateColumn({
    select: false,
    default: () => 'CURRENT_TIMESTAMP'
  })
  @ApiProperty({
    description: 'Date when the algorithm was created',
    example: '2024-01-15T10:30:00Z'
  })
  createdAt: Date;

  @UpdateDateColumn({
    select: false,
    default: () => 'CURRENT_TIMESTAMP'
  })
  @ApiProperty({
    description: 'Date when the algorithm was last updated',
    example: '2024-01-15T10:30:00Z'
  })
  updatedAt: Date;

  constructor(partial: Partial<Algorithm>) {
    Object.assign(this, partial);
  }

  @AfterLoad()
  @AfterInsert()
  setSlugAndDefaults() {
    if (this.name) {
      this.slug = this.name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]+/g, '')
        .replace(/--+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');

      // Set strategyId from name if not provided
      if (!this.strategyId) {
        this.strategyId = this.slug;
      }

      // Legacy service name support (deprecated)
      if (!this.service) {
        this.service = `${this.name.replace(/\s+/g, '')}Service`;
      }
    }

    // Initialize metrics if not present
    if (!this.metrics) {
      this.metrics = {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        successRate: 0,
        averageExecutionTime: 0,
        errorCount: 0
      };
    }
  }

  /**
   * Check if the algorithm is currently active and ready for execution
   */
  isActive(): boolean {
    return this.status === AlgorithmStatus.ACTIVE && this.evaluate;
  }

  /**
   * Check if the algorithm has a registered strategy
   */
  hasStrategy(): boolean {
    return !!this.strategyId;
  }

  /**
   * Get the success rate as a percentage
   */
  getSuccessRate(): number {
    if (!this.metrics?.totalExecutions || this.metrics.totalExecutions === 0) {
      return 0;
    }
    return ((this.metrics.successfulExecutions || 0) / this.metrics.totalExecutions) * 100;
  }

  /**
   * Update performance metrics after execution
   */
  updateMetrics(success: boolean, executionTime?: number, error?: string): void {
    if (!this.metrics) {
      this.metrics = {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        successRate: 0,
        averageExecutionTime: 0,
        errorCount: 0
      };
    }

    this.metrics.totalExecutions = (this.metrics.totalExecutions || 0) + 1;
    
    if (success) {
      this.metrics.successfulExecutions = (this.metrics.successfulExecutions || 0) + 1;
    } else {
      this.metrics.failedExecutions = (this.metrics.failedExecutions || 0) + 1;
      this.metrics.errorCount = (this.metrics.errorCount || 0) + 1;
      if (error) {
        this.metrics.lastError = error;
      }
    }

    if (executionTime) {
      const totalTime = (this.metrics.averageExecutionTime || 0) * ((this.metrics.totalExecutions || 1) - 1);
      this.metrics.averageExecutionTime = (totalTime + executionTime) / this.metrics.totalExecutions;
    }

    this.metrics.successRate = this.getSuccessRate();
    this.metrics.lastExecuted = new Date().toISOString();
  }

  /**
   * Check if algorithm needs maintenance based on error rate
   */
  needsMaintenance(): boolean {
    if (!this.metrics?.totalExecutions || this.metrics.totalExecutions < 10) {
      return false;
    }
    
    const errorRate = ((this.metrics.failedExecutions || 0) / this.metrics.totalExecutions) * 100;
    return errorRate > 20; // More than 20% failure rate
  }

  /**
   * Get algorithm configuration with defaults
   */
  getConfig(): AlgorithmConfig {
    return {
      parameters: {},
      settings: {
        timeout: 30000,
        retries: 3,
        enableLogging: true
      },
      metadata: {},
      ...this.config
    };
  }
}
