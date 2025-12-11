import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TagModule } from 'primeng/tag';

import { AlgorithmExecutionResponse } from '@chansey/api-interfaces';

import { SignalsDisplayComponent } from '../signals-display/signals-display.component';

interface ExecutionMode {
  label: string;
  value: boolean;
  icon: string;
}

@Component({
  selector: 'app-execution-panel',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    SelectButtonModule,
    TagModule,
    SignalsDisplayComponent
  ],
  template: `
    <p-card>
      <ng-template #header>
        <div class="flex items-center justify-between p-4 pb-0">
          <h3 class="m-0 text-lg font-semibold">Execute Algorithm</h3>
          @if (lastExecutionResult) {
            <p-tag
              [value]="lastExecutionResult.execution.success ? 'Success' : 'Failed'"
              [severity]="lastExecutionResult.execution.success ? 'success' : 'danger'"
            ></p-tag>
          }
        </div>
      </ng-template>

      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-4">
          <div>
            <label class="mb-2 block text-sm text-gray-500">Execution Mode</label>
            <p-selectButton
              [options]="executionModes"
              [(ngModel)]="selectedMode"
              optionLabel="label"
              optionValue="value"
            ></p-selectButton>
          </div>

          <div class="flex-1"></div>

          <p-button
            [label]="isExecuting() ? 'Executing...' : 'Execute'"
            icon="pi pi-play"
            [loading]="isExecuting()"
            [disabled]="isExecuting() || !canExecute"
            (onClick)="onExecute()"
          ></p-button>
        </div>

        <div class="text-sm text-gray-500">
          @if (selectedMode) {
            <i class="pi pi-info-circle mr-1"></i>
            Minimal context uses less data for faster execution. Full context includes all portfolio and price data.
          } @else {
            <i class="pi pi-info-circle mr-1"></i>
            Full context includes all portfolio and price data for comprehensive analysis.
          }
        </div>

        @if (lastExecutionResult) {
          <div class="space-y-4 border-t pt-4 dark:border-gray-700">
            <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <label class="mb-1 block text-sm text-gray-500">Execution Time</label>
                <span class="font-medium">{{
                  formatExecutionTime(lastExecutionResult.execution.metrics.executionTime)
                }}</span>
              </div>

              <div>
                <label class="mb-1 block text-sm text-gray-500">Signals Generated</label>
                <span class="font-medium">{{ lastExecutionResult.execution.metrics.signalsGenerated }}</span>
              </div>

              <div>
                <label class="mb-1 block text-sm text-gray-500">Confidence</label>
                <span class="font-medium">{{ formatPercent(lastExecutionResult.execution.metrics.confidence) }}</span>
              </div>

              <div>
                <label class="mb-1 block text-sm text-gray-500">Coins Analyzed</label>
                <span class="font-medium">{{ lastExecutionResult.context.coinsAnalyzed }}</span>
              </div>
            </div>

            @if (lastExecutionResult.execution.error) {
              <div class="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                <label class="mb-1 block text-sm font-medium text-red-600">Error</label>
                <p class="m-0 text-sm text-red-700 dark:text-red-400">{{ lastExecutionResult.execution.error }}</p>
              </div>
            }

            @if (lastExecutionResult.execution.signals && lastExecutionResult.execution.signals.length > 0) {
              <app-signals-display [signals]="lastExecutionResult.execution.signals"></app-signals-display>
            }
          </div>
        }

        @if (!canExecute && !isExecuting()) {
          <div
            class="rounded-md border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-900/20"
          >
            <i class="pi pi-exclamation-triangle mr-2 text-yellow-600"></i>
            <span class="text-sm text-yellow-700 dark:text-yellow-400">
              Algorithm must have a linked strategy to execute.
            </span>
          </div>
        }
      </div>
    </p-card>
  `
})
export class ExecutionPanelComponent {
  @Input() canExecute: boolean = false;
  @Input() lastExecutionResult?: AlgorithmExecutionResponse | null;

  @Output() execute = new EventEmitter<boolean>();

  isExecuting = signal(false);
  selectedMode = false; // false = full context, true = minimal

  executionModes: ExecutionMode[] = [
    { label: 'Full Context', value: false, icon: 'pi pi-th-large' },
    { label: 'Minimal', value: true, icon: 'pi pi-bolt' }
  ];

  onExecute(): void {
    this.isExecuting.set(true);
    this.execute.emit(this.selectedMode);
  }

  setExecuting(executing: boolean): void {
    this.isExecuting.set(executing);
  }

  formatExecutionTime(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  formatPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }
}
