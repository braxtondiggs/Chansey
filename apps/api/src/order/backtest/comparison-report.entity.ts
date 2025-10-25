import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  PrimaryColumn
} from 'typeorm';

import { Backtest } from './backtest.entity';

import { User } from '../../users/users.entity';

@Entity('comparison_reports')
export class ComparisonReport {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the comparison report' })
  id: string;

  @Column()
  @ApiProperty({ description: 'Display name for the report' })
  name: string;

  @Column({ type: 'jsonb', nullable: true })
  @ApiProperty({ description: 'Filters applied when creating the report', required: false })
  filters?: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'Timestamp when the report was created' })
  createdAt: Date;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdByUserId' })
  @ApiProperty({ description: 'User that created the report', required: false })
  createdBy?: User;

  @OneToMany(() => ComparisonReportRun, (run) => run.report, { cascade: true })
  runs: ComparisonReportRun[];
}

@Entity('comparison_report_runs')
export class ComparisonReportRun {
  @PrimaryColumn('uuid')
  comparisonReportId: string;

  @PrimaryColumn('uuid')
  backtestId: string;

  @ManyToOne(() => ComparisonReport, (report) => report.runs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'comparisonReportId' })
  report: ComparisonReport;

  @ManyToOne(() => Backtest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'backtestId' })
  backtest: Backtest;
}
