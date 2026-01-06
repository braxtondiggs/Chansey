import { CommonModule, DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { FloatLabelModule } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';

import { TradingStateDto } from '@chansey/api-interfaces';

import { TradingStateService } from './trading-state.service';

@Component({
  selector: 'app-trading-state',
  standalone: true,
  imports: [
    ButtonModule,
    CardModule,
    CommonModule,
    ConfirmDialogModule,
    DatePipe,
    DialogModule,
    FloatLabelModule,
    FluidModule,
    FormsModule,
    ProgressSpinnerModule,
    ReactiveFormsModule,
    TagModule,
    TextareaModule,
    ToastModule
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './trading-state.component.html'
})
export class TradingStateComponent {
  // State signals
  tradingState = signal<TradingStateDto | null>(null);
  haltDialogVisible = signal(false);
  resumeDialogVisible = signal(false);

  // Services
  private tradingStateService = inject(TradingStateService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private fb = inject(FormBuilder).nonNullable;

  // Forms
  haltForm = this.fb.group({
    reason: ['', [Validators.required, Validators.minLength(10)]],
    pauseDeployments: [false],
    cancelOpenOrders: [false]
  });

  resumeForm = this.fb.group({
    reason: ['']
  });

  // TanStack Query hooks
  tradingStateQuery = this.tradingStateService.useTradingState();
  haltMutation = this.tradingStateService.useHaltTrading();
  resumeMutation = this.tradingStateService.useResumeTrading();
  cancelAllOrdersMutation = this.tradingStateService.useCancelAllOrders();

  // Computed state
  isLoading = computed(() => this.tradingStateQuery.isPending() || this.tradingStateQuery.isFetching());
  isHaltPending = computed(() => this.haltMutation.isPending());
  isResumePending = computed(() => this.resumeMutation.isPending());
  isCancelAllOrdersPending = computed(() => this.cancelAllOrdersMutation.isPending());

  tradingEnabled = computed(() => this.tradingState()?.tradingEnabled ?? true);
  statusSeverity = computed(() => (this.tradingEnabled() ? 'success' : 'danger'));
  statusLabel = computed(() => (this.tradingEnabled() ? 'Trading Enabled' : 'Trading Halted'));

  haltDuration = computed(() => {
    const state = this.tradingState();
    if (!state?.haltDurationMs) return null;

    const seconds = Math.floor(state.haltDurationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  });

  constructor() {
    // Sync query data to signal
    effect(() => {
      const data = this.tradingStateQuery.data();
      if (data) {
        this.tradingState.set(data);
      }
    });
  }

  openHaltDialog(): void {
    this.haltForm.reset({
      reason: '',
      pauseDeployments: false,
      cancelOpenOrders: false
    });
    this.haltDialogVisible.set(true);
  }

  openResumeDialog(): void {
    this.resumeForm.reset({ reason: '' });
    this.resumeDialogVisible.set(true);
  }

  confirmHalt(): void {
    if (this.haltForm.invalid) {
      return;
    }

    const formValue = this.haltForm.value;

    this.haltMutation.mutate(
      {
        reason: formValue.reason!,
        pauseDeployments: formValue.pauseDeployments ?? false,
        cancelOpenOrders: formValue.cancelOpenOrders ?? false
      },
      {
        onSuccess: () => {
          this.messageService.add({
            severity: 'warn',
            summary: 'Trading Halted',
            detail: 'All trading has been halted system-wide'
          });
          this.haltDialogVisible.set(false);
        },
        onError: (error) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: error.message || 'Failed to halt trading'
          });
        }
      }
    );
  }

  confirmResume(): void {
    const formValue = this.resumeForm.value;

    this.resumeMutation.mutate(
      { reason: formValue.reason || undefined },
      {
        onSuccess: () => {
          this.messageService.add({
            severity: 'success',
            summary: 'Trading Resumed',
            detail: 'Trading has been resumed system-wide'
          });
          this.resumeDialogVisible.set(false);
        },
        onError: (error) => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: error.message || 'Failed to resume trading'
          });
        }
      }
    );
  }

  confirmCancelAllOrders(): void {
    this.confirmationService.confirm({
      message:
        'This will cancel ALL open orders across ALL users. This action cannot be undone. Are you absolutely sure?',
      header: 'Cancel All Orders',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary',
      accept: () => {
        this.cancelAllOrdersMutation.mutate(undefined, {
          onSuccess: (result) => {
            this.messageService.add({
              severity: result.failedCancellations > 0 ? 'warn' : 'success',
              summary: 'Orders Cancelled',
              detail: `${result.successfulCancellations}/${result.totalOrders} orders cancelled successfully`
            });
          },
          onError: (error) => {
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: error.message || 'Failed to cancel orders'
            });
          }
        });
      }
    });
  }

  refreshState(): void {
    this.tradingStateQuery.refetch();
  }
}
