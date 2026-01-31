import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';

import { BacktestFiltersDto, ExportFormat } from '@chansey/api-interfaces';

interface ExportRequest {
  type: 'backtests' | 'signals' | 'trades';
  format: ExportFormat;
  backtestId?: string;
}

@Component({
  selector: 'app-export-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, CardModule, InputTextModule, SelectButtonModule],
  template: `
    <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <!-- Export Backtests -->
      <p-card header="Export Backtests">
        <p class="mb-4 text-gray-500">
          Export all backtests matching the current filters. Includes performance metrics and algorithm information.
        </p>

        <div class="flex items-center gap-4">
          <p-selectbutton
            [(ngModel)]="backtestsFormat"
            [options]="formatOptions"
            optionLabel="label"
            optionValue="value"
          />

          <p-button label="Export Backtests" icon="pi pi-download" (onClick)="exportBacktests()" />
        </div>

        @if (
          filters && (filters.startDate || filters.endDate || filters.status || filters.type || filters.algorithmId)
        ) {
          <div class="mt-3 text-sm text-gray-400">
            <i class="pi pi-filter mr-1"></i>
            Filters applied
          </div>
        }
      </p-card>

      <!-- Export Signals -->
      <p-card header="Export Signals">
        <p class="mb-4 text-gray-500">
          Export all signals from a specific backtest. Includes timestamps, types, confidence scores, and outcomes.
        </p>

        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-2">
            <label class="w-24 text-sm text-gray-500">Backtest ID:</label>
            <input
              type="text"
              pInputText
              [(ngModel)]="signalsBacktestId"
              placeholder="Enter backtest ID"
              class="flex-1"
            />
          </div>

          <div class="flex items-center gap-4">
            <p-selectbutton
              [(ngModel)]="signalsFormat"
              [options]="formatOptions"
              optionLabel="label"
              optionValue="value"
            />

            <p-button
              label="Export Signals"
              icon="pi pi-download"
              [disabled]="!signalsBacktestId"
              (onClick)="exportSignals()"
            />
          </div>
        </div>
      </p-card>

      <!-- Export Trades -->
      <p-card header="Export Trades">
        <p class="mb-4 text-gray-500">
          Export all trades from a specific backtest. Includes execution details, P&L, and timing information.
        </p>

        <div class="flex flex-col gap-4">
          <div class="flex items-center gap-2">
            <label class="w-24 text-sm text-gray-500">Backtest ID:</label>
            <input
              type="text"
              pInputText
              [(ngModel)]="tradesBacktestId"
              placeholder="Enter backtest ID"
              class="flex-1"
            />
          </div>

          <div class="flex items-center gap-4">
            <p-selectbutton
              [(ngModel)]="tradesFormat"
              [options]="formatOptions"
              optionLabel="label"
              optionValue="value"
            />

            <p-button
              label="Export Trades"
              icon="pi pi-download"
              [disabled]="!tradesBacktestId"
              (onClick)="exportTrades()"
            />
          </div>
        </div>
      </p-card>

      <!-- Export Info -->
      <p-card header="Export Information">
        <div class="space-y-3">
          <div class="flex items-start gap-3">
            <i class="pi pi-file mt-1 text-blue-500"></i>
            <div>
              <div class="font-medium">CSV Format</div>
              <div class="text-sm text-gray-500">
                Comma-separated values. Compatible with Excel, Google Sheets, and most data analysis tools.
              </div>
            </div>
          </div>

          <div class="flex items-start gap-3">
            <i class="pi pi-code mt-1 text-green-500"></i>
            <div>
              <div class="font-medium">JSON Format</div>
              <div class="text-sm text-gray-500">
                Structured data format. Ideal for programmatic processing and API integration.
              </div>
            </div>
          </div>

          <div class="mt-4 rounded-lg bg-gray-100 p-3 dark:bg-gray-800">
            <div class="flex items-center gap-2 text-sm">
              <i class="pi pi-info-circle text-blue-500"></i>
              <span>
                Backtest IDs can be found in the backtests table on the Overview tab or in the URL when viewing a
                specific backtest.
              </span>
            </div>
          </div>
        </div>
      </p-card>
    </div>
  `
})
export class ExportPanelComponent {
  @Input() filters: BacktestFiltersDto | undefined;
  @Output() exportRequest = new EventEmitter<ExportRequest>();

  formatOptions = [
    { label: 'CSV', value: ExportFormat.CSV },
    { label: 'JSON', value: ExportFormat.JSON }
  ];

  backtestsFormat: ExportFormat = ExportFormat.CSV;
  signalsFormat: ExportFormat = ExportFormat.CSV;
  tradesFormat: ExportFormat = ExportFormat.CSV;

  signalsBacktestId = '';
  tradesBacktestId = '';

  exportBacktests(): void {
    this.exportRequest.emit({
      type: 'backtests',
      format: this.backtestsFormat
    });
  }

  exportSignals(): void {
    if (!this.signalsBacktestId) return;

    this.exportRequest.emit({
      type: 'signals',
      format: this.signalsFormat,
      backtestId: this.signalsBacktestId
    });
  }

  exportTrades(): void {
    if (!this.tradesBacktestId) return;

    this.exportRequest.emit({
      type: 'trades',
      format: this.tradesFormat,
      backtestId: this.tradesBacktestId
    });
  }
}
