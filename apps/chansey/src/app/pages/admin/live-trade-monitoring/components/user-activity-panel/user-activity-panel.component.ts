import { CommonModule, CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { RippleModule } from 'primeng/ripple';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { PaginatedUserActivityDto } from '../../live-trade-monitoring.service';

@Component({
  selector: 'app-user-activity-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ButtonModule,
    CardModule,
    RippleModule,
    TableModule,
    TagModule,
    DecimalPipe,
    CurrencyPipe,
    DatePipe
  ],
  template: `
    <div class="mt-4">
      <p-card>
        <ng-template #header>
          <div class="flex items-center gap-2 p-3">
            <i class="pi pi-users text-primary text-xl"></i>
            <span class="font-semibold">Users with Active Algorithms</span>
          </div>
        </ng-template>

        <p-table
          [value]="userActivity?.data || []"
          [tableStyle]="{ 'min-width': '100%' }"
          [lazy]="true"
          [paginator]="true"
          [rows]="userActivity?.limit || 10"
          [totalRecords]="userActivity?.total || 0"
          [showCurrentPageReport]="true"
          currentPageReportTemplate="Showing {first} to {last} of {totalRecords} users"
          [expandedRowKeys]="expandedRows"
          dataKey="userId"
          (onLazyLoad)="onLazyLoad($event)"
        >
          <ng-template #header>
            <tr>
              <th style="width: 3rem"></th>
              <th>User</th>
              <th class="text-center">Active Algos</th>
              <th class="text-right">Orders</th>
              <th class="text-right">24h Orders</th>
              <th class="text-right">Volume</th>
              <th class="text-right">P&L</th>
              <th class="text-right">Avg Slippage</th>
              <th>Last Order</th>
            </tr>
          </ng-template>
          <ng-template #body let-user let-expanded="expanded">
            <tr>
              <td>
                <button
                  type="button"
                  pButton
                  pRipple
                  [pRowToggler]="user"
                  class="p-button-text p-button-rounded p-button-plain"
                  [icon]="expanded ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
                ></button>
              </td>
              <td>
                <div class="flex flex-col">
                  <span class="font-medium">{{ user.email }}</span>
                  @if (user.firstName || user.lastName) {
                    <span class="text-xs text-gray-500">{{ user.firstName }} {{ user.lastName }}</span>
                  }
                </div>
              </td>
              <td class="text-center">
                <p-tag [value]="user.activeAlgorithms.toString()" severity="success" />
              </td>
              <td class="text-right">{{ user.totalOrders }}</td>
              <td class="text-right">{{ user.orders24h }}</td>
              <td class="text-right">{{ user.totalVolume | currency: 'USD' : 'symbol' : '1.0-0' }}</td>
              <td class="text-right" [class]="user.totalPnL >= 0 ? 'text-green-500' : 'text-red-500'">
                {{ user.totalPnL | currency: 'USD' : 'symbol' : '1.2-2' }}
              </td>
              <td class="text-right">
                @if (user.avgSlippageBps !== undefined) {
                  {{ user.avgSlippageBps | number: '1.1-1' }} bps
                } @else {
                  <span class="text-gray-400">N/A</span>
                }
              </td>
              <td>
                @if (user.lastOrderAt) {
                  {{ user.lastOrderAt | date: 'short' }}
                } @else {
                  <span class="text-gray-400">Never</span>
                }
              </td>
            </tr>
          </ng-template>
          <ng-template #rowexpansion let-user>
            <tr>
              <td colspan="9">
                <div class="p-4">
                  <h4 class="mb-3 font-semibold">Algorithm Activations</h4>
                  <p-table [value]="user.algorithms" [tableStyle]="{ 'min-width': '100%' }">
                    <ng-template #header>
                      <tr>
                        <th>Algorithm</th>
                        <th class="text-center">Status</th>
                        <th class="text-right">Orders</th>
                        <th class="text-right">ROI</th>
                      </tr>
                    </ng-template>
                    <ng-template #body let-algo>
                      <tr>
                        <td>{{ algo.algorithmName }}</td>
                        <td class="text-center">
                          <p-tag
                            [severity]="algo.isActive ? 'success' : 'secondary'"
                            [value]="algo.isActive ? 'Active' : 'Inactive'"
                          />
                        </td>
                        <td class="text-right">{{ algo.totalOrders }}</td>
                        <td class="text-right" [class]="(algo.roi || 0) >= 0 ? 'text-green-500' : 'text-red-500'">
                          @if (algo.roi !== undefined) {
                            {{ algo.roi | number: '1.2-2' }}%
                          } @else {
                            <span class="text-gray-400">N/A</span>
                          }
                        </td>
                      </tr>
                    </ng-template>
                    <ng-template #emptymessage>
                      <tr>
                        <td colspan="4" class="text-center text-gray-500">No algorithms</td>
                      </tr>
                    </ng-template>
                  </p-table>
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template #emptymessage>
            <tr>
              <td colspan="9" class="py-8 text-center">
                <div class="flex flex-col items-center text-gray-500">
                  <i class="pi pi-users mb-2 text-4xl"></i>
                  <span>No users with active algorithms found</span>
                </div>
              </td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `
})
export class UserActivityPanelComponent {
  @Input() userActivity: PaginatedUserActivityDto | undefined;
  @Output() pageChange = new EventEmitter<number>();

  expandedRows: Record<string, boolean> = {};

  onLazyLoad(event: { first?: number | null; rows?: number | null }): void {
    const page = Math.floor((event.first ?? 0) / (event.rows ?? 10)) + 1;
    this.pageChange.emit(page);
  }
}
