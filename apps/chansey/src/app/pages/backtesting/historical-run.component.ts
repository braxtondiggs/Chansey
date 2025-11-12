import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';

import {
  Algorithm,
  BacktestRunSummary,
  BacktestType,
  MarketDataSet,
  CreateBacktestRequest
} from '@chansey/api-interfaces';

import { AlgorithmsService } from '@chansey-web/app/pages/admin/algorithms/algorithms.service';
import { BacktestingService } from '@chansey-web/app/shared/services/backtesting.service';

@Component({
  selector: 'app-historical-run',
  standalone: true,
  imports: [
    ButtonModule,
    CardModule,
    CommonModule,
    FloatLabelModule,
    InputNumberModule,
    InputTextModule,
    ReactiveFormsModule,
    SelectModule,
    TableModule,
    TagModule,
    ToastModule
  ],
  templateUrl: './historical-run.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [MessageService]
})
export class HistoricalRunComponent {
  private readonly algorithmsService = inject(AlgorithmsService);
  private readonly backtestingService = inject(BacktestingService);
  private readonly fb = inject(FormBuilder);
  private readonly messageService = inject(MessageService);

  // Queries
  algorithmsQuery = this.algorithmsService.useAlgorithms();
  datasetsQuery = this.backtestingService.useDatasets();
  backtestsQuery = this.backtestingService.useBacktests();
  createBacktestMutation = this.backtestingService.useCreateBacktest();

  // Signals for data
  algorithms = signal<Algorithm[]>([]);
  datasets = signal<MarketDataSet[]>([]);
  backtests = signal<BacktestRunSummary[]>([]);
  historicalRuns = computed(() => this.backtests().filter((run) => run.type === BacktestType.HISTORICAL));

  selectedRun = signal<BacktestRunSummary | null>(null);

  isSubmitting = signal(false);

  form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    algorithmId: ['', Validators.required],
    marketDataSetId: ['', Validators.required],
    initialCapital: [10000, [Validators.required, Validators.min(100)]],
    tradingFee: [0.001, [Validators.min(0), Validators.max(0.1)]],
    deterministicSeed: ['']
  });

  constructor() {
    effect(() => {
      const algos = this.algorithmsQuery.data();
      if (algos) {
        this.algorithms.set(algos);
      }
    });

    effect(() => {
      const sets = this.datasetsQuery.data();
      if (sets) {
        this.datasets.set(sets);
      }
    });

    effect(() => {
      const runs = this.backtestsQuery.data();
      if (runs) {
        this.backtests.set(runs.items ?? []);
      }
    });

    effect(() => {
      const isPending = this.createBacktestMutation.isPending();
      this.isSubmitting.set(isPending);
    });

    effect(() => {
      const algoId = this.form.controls.algorithmId.value;
      const datasetId = this.form.controls.marketDataSetId.value;
      const currentName = this.form.controls.name.value;
      if (!currentName && algoId && datasetId) {
        const algo = this.algorithms().find((item) => item.id === algoId);
        const dataset = this.datasets().find((item) => item.id === datasetId);
        const generated = `Backtest - ${algo?.name ?? 'Algorithm'} (${dataset?.label ?? 'Dataset'})`;
        this.form.controls.name.setValue(generated.substring(0, 120), { emitEvent: false });
      }
    });
  }

  readonly algorithmsLoading = computed(() => this.algorithmsQuery.isPending());
  readonly datasetsLoading = computed(() => this.datasetsQuery.isPending());
  readonly backtestsLoading = computed(() => this.backtestsQuery.isPending() || this.backtestsQuery.isFetching());

  readonly statusSeverity = (status: BacktestRunSummary['status']): 'success' | 'warn' | 'danger' | 'info' => {
    switch (status) {
      case 'COMPLETED':
        return 'success';
      case 'RUNNING':
      case 'PENDING':
        return 'info';
      case 'FAILED':
      case 'CANCELLED':
        return 'danger';
      default:
        return 'warn';
    }
  };

  onSubmit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    const formValue = this.form.getRawValue();
    const dataset = this.datasets().find((item) => item.id === formValue.marketDataSetId);
    const algorithm = this.algorithms().find((item) => item.id === formValue.algorithmId);

    if (!dataset || !algorithm) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Selection required',
        detail: 'Choose algorithm and dataset.'
      });
      return;
    }

    const payload: CreateBacktestRequest = {
      name: formValue.name || `Backtest - ${algorithm.name}`.substring(0, 120),
      description: dataset.label,
      algorithmId: formValue.algorithmId,
      marketDataSetId: formValue.marketDataSetId,
      type: BacktestType.HISTORICAL,
      mode: 'historical',
      initialCapital: formValue.initialCapital,
      tradingFee: formValue.tradingFee,
      startDate: dataset.startAt,
      endDate: dataset.endAt,
      executionWindow: {
        startAt: dataset.startAt,
        endAt: dataset.endAt
      },
      deterministicSeed: formValue.deterministicSeed || undefined
    };

    this.createBacktestMutation.mutate(payload, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Backtest queued',
          detail: `${algorithm.name} scheduled.`
        });
        this.form.patchValue({ deterministicSeed: '' });
      },
      onError: (error) => {
        this.messageService.add({ severity: 'error', summary: 'Backtest failed', detail: error.message });
      }
    });
  }

  onSelectRun(run?: BacktestRunSummary | BacktestRunSummary[]): void {
    if (!run || Array.isArray(run)) return;
    this.selectedRun.set(run);
  }
}
