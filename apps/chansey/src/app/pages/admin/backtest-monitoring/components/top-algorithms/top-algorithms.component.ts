import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';

import { TopAlgorithmDto } from '@chansey/api-interfaces';

@Component({
  selector: 'app-top-algorithms',
  standalone: true,
  imports: [CommonModule, CardModule, DecimalPipe, TableModule, TagModule],
  template: `
    <p-card header="Top Performing Algorithms">
      <p-table [value]="algorithms" styleClass="p-datatable-sm">
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 40px">#</th>
            <th>Algorithm</th>
            <th class="text-right">Avg Sharpe</th>
            <th class="text-right">Avg Return</th>
            <th class="text-right">Backtests</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-algo let-rowIndex="rowIndex">
          <tr>
            <td>
              <p-tag [severity]="getRankSeverity(rowIndex)" [value]="(rowIndex + 1).toString()" [rounded]="true" />
            </td>
            <td class="font-medium">{{ algo.name }}</td>
            <td class="text-right">
              <span [class]="algo.avgSharpe >= 1 ? 'font-medium text-green-500' : ''">
                {{ algo.avgSharpe | number: '1.2-2' }}
              </span>
            </td>
            <td class="text-right">
              <span [class]="algo.avgReturn >= 0 ? 'text-green-500' : 'text-red-500'">
                {{ algo.avgReturn | number: '1.1-1' }}%
              </span>
            </td>
            <td class="text-right text-gray-500">{{ algo.backtestCount }}</td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="5" class="py-4 text-center text-gray-500">
              No algorithm data available (minimum 3 backtests required)
            </td>
          </tr>
        </ng-template>
      </p-table>
    </p-card>
  `
})
export class TopAlgorithmsComponent {
  @Input() algorithms: TopAlgorithmDto[] = [];

  getRankSeverity(index: number): 'success' | 'warn' | 'info' | 'secondary' {
    if (index === 0) return 'success';
    if (index === 1) return 'warn';
    if (index === 2) return 'info';
    return 'secondary';
  }
}
