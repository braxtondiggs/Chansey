import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { CardModule } from 'primeng/card';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { PaginatedOrderListDto } from '../../live-trade-monitoring.service';

@Component({
  selector: 'app-orders-table',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    TableModule,
    TagModule,
    ProgressSpinnerModule,
    DecimalPipe,
    CurrencyPipe,
    DatePipe
  ],
  template: `
    <p-card>
      <ng-template #header>
        <div class="flex items-center justify-between p-3">
          <div class="flex items-center gap-2">
            <i class="pi pi-list text-primary text-xl"></i>
            <span class="font-semibold">Algorithmic Orders</span>
          </div>
          @if (orders) {
            <div class="flex items-center gap-4 text-sm text-gray-500">
              <span>Volume: {{ orders.totalVolume | currency: 'USD' : 'symbol' : '1.0-0' }}</span>
              <span [class]="orders.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'">
                P&L: {{ orders.totalPnL | currency: 'USD' : 'symbol' : '1.2-2' }}
              </span>
              <span>Avg Slippage: {{ orders.avgSlippageBps | number: '1.1-1' }} bps</span>
            </div>
          }
        </div>
      </ng-template>

      @if (isLoading) {
        <div class="flex items-center justify-center py-8">
          <p-progress-spinner strokeWidth="4" />
        </div>
      } @else {
        <p-table
          [value]="orders?.data || []"
          [tableStyle]="{ 'min-width': '100%' }"
          [lazy]="true"
          [paginator]="true"
          [rows]="orders?.limit || 10"
          [totalRecords]="orders?.total || 0"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Showing {first} to {last} of {totalRecords} orders"
          (onLazyLoad)="onLazyLoad($event)"
        >
          <ng-template #header>
            <tr>
              <th>Symbol</th>
              <th>Side</th>
              <th>Type</th>
              <th>Status</th>
              <th class="text-right">Quantity</th>
              <th class="text-right">Price</th>
              <th class="text-right">Cost</th>
              <th class="text-right">Slippage</th>
              <th>Algorithm</th>
              <th>User</th>
              <th>Time</th>
            </tr>
          </ng-template>
          <ng-template #body let-order>
            <tr>
              <td class="font-medium">{{ order.symbol }}</td>
              <td>
                <p-tag [severity]="order.side === 'BUY' ? 'success' : 'danger'" [value]="order.side" />
              </td>
              <td>
                <p-tag [severity]="getTypeSeverity(order.type)" [value]="formatType(order.type)" />
              </td>
              <td>
                <p-tag [severity]="getStatusSeverity(order.status)" [value]="order.status" />
              </td>
              <td class="text-right">{{ order.executedQuantity | number: '1.4-4' }}</td>
              <td class="text-right">{{ order.price | currency: 'USD' : 'symbol' : '1.2-2' }}</td>
              <td class="text-right">{{ order.cost | currency: 'USD' : 'symbol' : '1.2-2' }}</td>
              <td class="text-right" [class]="getSlippageClass(order.actualSlippageBps)">
                @if (order.actualSlippageBps !== undefined && order.actualSlippageBps !== null) {
                  {{ order.actualSlippageBps | number: '1.1-1' }} bps
                } @else {
                  <span class="text-gray-400">N/A</span>
                }
              </td>
              <td>{{ order.algorithmName }}</td>
              <td>
                <span class="text-sm">{{ order.userEmail }}</span>
              </td>
              <td>{{ order.createdAt | date: 'short' }}</td>
            </tr>
          </ng-template>
          <ng-template #emptymessage>
            <tr>
              <td colspan="11" class="py-8 text-center text-gray-500">
                <i class="pi pi-inbox mb-2 text-4xl"></i>
                <p>No algorithmic orders found</p>
              </td>
            </tr>
          </ng-template>
        </p-table>
      }
    </p-card>
  `
})
export class OrdersTableComponent {
  @Input() orders: PaginatedOrderListDto | undefined;
  @Input() isLoading = false;
  @Output() pageChange = new EventEmitter<number>();

  onLazyLoad(event: { first?: number | null; rows?: number | null }): void {
    const page = Math.floor((event.first ?? 0) / (event.rows ?? 10)) + 1;
    this.pageChange.emit(page);
  }

  getTypeSeverity(type: string): 'info' | 'secondary' {
    return type === 'market' ? 'info' : 'secondary';
  }

  formatType(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, ' ');
  }

  getStatusSeverity(status: string): 'success' | 'danger' | 'warn' | 'info' {
    switch (status) {
      case 'FILLED':
        return 'success';
      case 'CANCELED':
      case 'REJECTED':
      case 'EXPIRED':
        return 'danger';
      case 'PARTIALLY_FILLED':
        return 'warn';
      default:
        return 'info';
    }
  }

  getSlippageClass(slippage: number | undefined): string {
    if (slippage === undefined || slippage === null) return '';
    if (slippage > 50) return 'text-red-500 font-bold';
    if (slippage > 30) return 'text-yellow-500 font-medium';
    return 'text-green-500';
  }
}
