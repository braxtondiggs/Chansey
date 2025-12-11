import { CommonModule, Location } from '@angular/common';
import { Component, computed, inject, signal, ViewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { injectQuery } from '@tanstack/angular-query-experimental';
import { MessageService, ConfirmationService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { ToastModule } from 'primeng/toast';
import { map } from 'rxjs/operators';

import {
  AlgorithmDetailResponse,
  AlgorithmDrawerSaveEvent,
  AlgorithmExecutionResponse,
  AlgorithmPerformance,
  AlgorithmStrategy,
  UpdateAlgorithmDto
} from '@chansey/api-interfaces';

import { AlgorithmsService } from '../algorithms.service';
import { AlgorithmEditDrawerComponent } from '../components/algorithm-edit-drawer/algorithm-edit-drawer.component';
import { AlgorithmInfoCardComponent } from '../components/algorithm-info-card/algorithm-info-card.component';
import { ExecutionPanelComponent } from '../components/execution-panel/execution-panel.component';
import { MetricsCardComponent } from '../components/metrics-card/metrics-card.component';
import { PerformanceChartComponent } from '../components/performance-chart/performance-chart.component';
import { StrategyCardComponent } from '../components/strategy-card/strategy-card.component';
import { AlgorithmDetailQueries, TimePeriod } from '../services/algorithm-detail.queries';

@Component({
  selector: 'app-algorithm-detail',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    CardModule,
    SkeletonModule,
    ToastModule,
    ConfirmDialogModule,
    AlgorithmEditDrawerComponent,
    AlgorithmInfoCardComponent,
    StrategyCardComponent,
    MetricsCardComponent,
    PerformanceChartComponent,
    ExecutionPanelComponent
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './algorithm-detail.component.html',
  styleUrls: ['./algorithm-detail.component.scss']
})
export class AlgorithmDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private queries = inject(AlgorithmDetailQueries);
  private algorithmsService = inject(AlgorithmsService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);

  @ViewChild(ExecutionPanelComponent) executionPanel?: ExecutionPanelComponent;
  @ViewChild('editDrawer') editDrawer!: AlgorithmEditDrawerComponent;

  // Extract ID from route reactively using toSignal
  private routeParams = toSignal(this.route.paramMap.pipe(map((params) => params.get('id') || '')));
  public algorithmId = computed(() => this.routeParams() || '');

  // State
  selectedPeriod = signal<TimePeriod>('7d');
  lastExecutionResult = signal<AlgorithmExecutionResponse | null>(null);
  strategies = signal<AlgorithmStrategy[]>([]);

  // Queries - now reactive to route changes
  detailQuery = injectQuery(() => this.queries.useAlgorithmDetailQuery(this.algorithmId()));

  performanceHistoryQuery = injectQuery(() =>
    this.queries.useAlgorithmPerformanceHistoryQuery(this.algorithmId(), this.selectedPeriod(), {
      enabled: !!this.algorithmId()
    })
  );

  strategiesQuery = this.algorithmsService.useStrategies();

  // Mutations
  deleteMutation = this.algorithmsService.useDeleteAlgorithm();
  updateMutation = this.algorithmsService.useUpdateAlgorithm();

  // Computed state
  get algorithm(): AlgorithmDetailResponse | null {
    return this.detailQuery.data() ?? null;
  }

  get isLoading(): boolean {
    return this.detailQuery.isLoading();
  }

  get error(): string | undefined {
    return this.detailQuery.error()?.message;
  }

  get performanceHistory(): AlgorithmPerformance[] | null {
    return this.performanceHistoryQuery.data() ?? null;
  }

  get isPerformanceLoading(): boolean {
    return this.performanceHistoryQuery.isLoading();
  }

  get strategiesData(): AlgorithmStrategy[] {
    return this.strategiesQuery.data() ?? [];
  }

  get isUpdatePending(): boolean {
    return this.updateMutation.isPending();
  }

  /**
   * Handle period change from performance chart
   */
  onPeriodChange(period: TimePeriod): void {
    this.selectedPeriod.set(period);
  }

  /**
   * Execute algorithm with specified context mode
   */
  async onExecute(minimal: boolean): Promise<void> {
    if (!this.algorithm?.hasStrategy) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Cannot Execute',
        detail: 'Algorithm must have a linked strategy to execute.'
      });
      this.executionPanel?.setExecuting(false);
      return;
    }

    try {
      // Execute via direct fetch since injectMutation requires component-level setup
      const result = await fetch(`/api/algorithm/${this.algorithmId()}/execute?minimal=${minimal}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });

      if (!result.ok) {
        throw new Error('Execution failed');
      }

      const data: AlgorithmExecutionResponse = await result.json();
      this.lastExecutionResult.set(data);

      this.messageService.add({
        severity: data.execution.success ? 'success' : 'warn',
        summary: data.execution.success ? 'Execution Complete' : 'Execution Warning',
        detail: `Generated ${data.execution.metrics.signalsGenerated} signals in ${data.execution.metrics.executionTime}ms`
      });

      // Refresh algorithm data to update metrics
      this.queries.invalidateAlgorithmQueries(this.algorithmId());
    } catch (error) {
      this.messageService.add({
        severity: 'error',
        summary: 'Execution Failed',
        detail: error instanceof Error ? error.message : 'An error occurred during execution'
      });
    } finally {
      this.executionPanel?.setExecuting(false);
    }
  }

  /**
   * Open edit drawer for this algorithm
   */
  onEdit(): void {
    if (this.algorithm) {
      this.editDrawer.openForEdit(this.algorithm);
    }
  }

  /**
   * Handle save from edit drawer
   */
  onDrawerSave(event: AlgorithmDrawerSaveEvent): void {
    if (event.id) {
      const updateData: UpdateAlgorithmDto = { ...event.data, id: event.id };
      this.updateMutation.mutate(updateData, {
        onSuccess: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: 'Algorithm updated successfully'
          });
          this.editDrawer.hideDrawer();
          this.queries.invalidateAlgorithmQueries(this.algorithmId());
        },
        onError: (error) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: error.message || 'Failed to update algorithm'
          });
        }
      });
    }
  }

  /**
   * Confirm and delete algorithm
   */
  onDelete(): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete "${this.algorithm?.name}"? This action cannot be undone.`,
      header: 'Delete Algorithm',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: async () => {
        try {
          await this.deleteMutation.mutateAsync(this.algorithmId());
          this.messageService.add({
            severity: 'success',
            summary: 'Deleted',
            detail: 'Algorithm deleted successfully'
          });
          this.router.navigate(['/admin/algorithms']);
        } catch {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to delete algorithm'
          });
        }
      }
    });
  }

  /**
   * Retry loading data after error
   */
  retry(): void {
    this.queries.invalidateAlgorithmQueries(this.algorithmId());
  }

  /**
   * Check if error is a 404
   */
  is404Error(): boolean {
    return this.error?.toLowerCase().includes('not found') ?? false;
  }

  /**
   * Navigate back to algorithms list
   */
  goBack(): void {
    this.location.back();
  }

  /**
   * Navigate to algorithms list
   */
  goToList(): void {
    this.router.navigate(['/admin/algorithms']);
  }
}
