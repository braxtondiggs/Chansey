import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TimelineModule } from 'primeng/timeline';

import {
  Algorithm,
  BacktestRunSummary,
  BacktestType,
  CreateBacktestRequest,
  MarketDataSet
} from '@chansey/api-interfaces';

import { AlgorithmsService } from '@chansey-web/app/pages/admin/algorithms/algorithms.service';
import { BacktestingService } from '@chansey-web/app/shared/services/backtesting.service';

interface TelemetryEvent {
  scope: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

@Component({
  selector: 'app-live-replay',
  standalone: true,
  imports: [
    ButtonModule,
    CardModule,
    CommonModule,
    FloatLabelModule,
    InputNumberModule,
    InputTextModule,
    MessageModule,
    ReactiveFormsModule,
    SelectModule,
    TableModule,
    TagModule,
    TimelineModule
  ],
  templateUrl: './live-replay.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LiveReplayComponent implements OnDestroy {
  private readonly algorithmsService = inject(AlgorithmsService);
  private readonly backtestingService = inject(BacktestingService);
  private readonly fb = inject(FormBuilder);

  algorithmsQuery = this.algorithmsService.useAlgorithms();
  datasetsQuery = this.backtestingService.useDatasets();
  backtestsQuery = this.backtestingService.useBacktests();
  createBacktestMutation = this.backtestingService.useCreateBacktest();

  algorithms = signal<Algorithm[]>([]);
  datasets = signal<MarketDataSet[]>([]);
  backtests = signal<BacktestRunSummary[]>([]);

  replayRuns = computed(() => this.backtests().filter((run) => run.type === BacktestType.LIVE_REPLAY));
  replayDatasets = computed(() => this.datasets().filter((dataset) => dataset.replayCapable));

  selectedRun = signal<BacktestRunSummary | null>(null);
  telemetryEvents = signal<TelemetryEvent[]>([]);
  isSubmitting = signal(false);

  private telemetrySubscription: { disconnect: () => void } | null = null;

  form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    algorithmId: ['', Validators.required],
    marketDataSetId: ['', Validators.required],
    initialCapital: [5000, [Validators.required, Validators.min(100)]],
    tradingFee: [0.0005, [Validators.min(0), Validators.max(0.1)]],
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
      this.isSubmitting.set(this.createBacktestMutation.isPending());
    });
  }

  ngOnDestroy(): void {
    this.detachTelemetry();
  }

  readonly isLoading = computed(() => this.backtestsQuery.isPending() || this.backtestsQuery.isFetching());

  readonly statusSeverity = (status: BacktestRunSummary['status']): 'success' | 'warn' | 'info' | 'danger' => {
    switch (status) {
      case 'COMPLETED':
        return 'success';
      case 'RUNNING':
      case 'PENDING':
      case 'PAUSED':
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

    if (!dataset || !dataset.replayCapable || !algorithm) {
      return;
    }

    const payload: CreateBacktestRequest = {
      name: formValue.name || `Live Replay - ${algorithm.name}`.substring(0, 120),
      description: `Live replay using ${dataset.label}`,
      algorithmId: algorithm.id,
      marketDataSetId: dataset.id,
      type: BacktestType.LIVE_REPLAY,
      mode: 'live_replay',
      startDate: dataset.startAt,
      endDate: dataset.endAt,
      initialCapital: formValue.initialCapital,
      tradingFee: formValue.tradingFee,
      deterministicSeed: formValue.deterministicSeed || undefined
    };

    this.createBacktestMutation.mutate(payload, {
      onSuccess: () => {
        this.form.patchValue({ deterministicSeed: '' });
      }
    });
  }

  onSelectRun(run?: BacktestRunSummary | BacktestRunSummary[]): void {
    if (!run || Array.isArray(run)) return;
    this.selectedRun.set(run);
    this.telemetryEvents.set([]);
    this.attachTelemetry(run.id);
  }

  private attachTelemetry(backtestId: string): void {
    this.detachTelemetry();
    const subscription = this.backtestingService.subscribeToTelemetry(backtestId);
    subscription.on('log', (payload) => this.pushEvent('log', payload as Record<string, unknown>));
    subscription.on('metric', (payload) => this.pushEvent('metric', payload as Record<string, unknown>));
    subscription.on('status', (payload) => this.pushEvent('status', payload as Record<string, unknown>));
    subscription.on('trace', (payload) => this.pushEvent('trace', payload as Record<string, unknown>));
    this.telemetrySubscription = subscription;
  }

  private pushEvent(scope: string, payload: Record<string, unknown>): void {
    const event: TelemetryEvent = {
      scope,
      payload,
      timestamp: new Date().toISOString()
    };
    this.telemetryEvents.update((events) => [event, ...events].slice(0, 50));
  }

  private detachTelemetry(): void {
    if (this.telemetrySubscription) {
      this.telemetrySubscription.disconnect();
      this.telemetrySubscription = null;
    }
  }
}
