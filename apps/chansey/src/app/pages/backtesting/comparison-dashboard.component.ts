import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { CheckboxModule } from 'primeng/checkbox';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { BacktestRunSummary, ComparisonReportResponse } from '@chansey/api-interfaces';

import { BacktestingService } from '@chansey-web/app/shared/services/backtesting.service';

@Component({
  selector: 'app-comparison-dashboard',
  standalone: true,
  imports: [
    ButtonModule,
    CardModule,
    CheckboxModule,
    CommonModule,
    FloatLabelModule,
    InputTextModule,
    MessageModule,
    ReactiveFormsModule,
    TableModule,
    TagModule
  ],
  templateUrl: './comparison-dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ComparisonDashboardComponent {
  private readonly backtestingService = inject(BacktestingService);
  private readonly fb = inject(FormBuilder);

  backtestsQuery = this.backtestingService.useBacktests();
  createReportMutation = this.backtestingService.useCreateComparisonReport();

  backtests = signal<BacktestRunSummary[]>([]);
  selectedRunIds = signal<Set<string>>(new Set());
  comparisonResult = signal<ComparisonReportResponse | null>(null);

  form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(120)]]
  });

  constructor() {
    effect(() => {
      const runs = this.backtestsQuery.data();
      if (runs) {
        this.backtests.set(runs.items ?? []);
      }
    });

    effect(() => {
      if (this.createReportMutation.isSuccess()) {
        this.comparisonResult.set(this.createReportMutation.data() ?? null);
      }
    });
  }

  readonly completedRuns = computed(() =>
    this.backtests().filter((run) => run.status === 'COMPLETED' || run.status === 'CANCELLED')
  );

  readonly disableCompare = computed(() => this.selectedRunIds().size < 2 || this.form.invalid);

  toggleRunSelection(run: BacktestRunSummary, checked: boolean): void {
    const updated = new Set(this.selectedRunIds());
    if (checked) {
      updated.add(run.id);
    } else {
      updated.delete(run.id);
    }
    this.selectedRunIds.set(updated);
  }

  async createComparison(): Promise<void> {
    if (this.disableCompare()) {
      return;
    }

    const payload = {
      name: this.form.controls.name.value,
      runIds: Array.from(this.selectedRunIds())
    };

    this.createReportMutation.mutate(payload);
  }
}
