import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

import { Algorithm, AlgorithmCategory, AlgorithmStatus } from '@chansey/api-interfaces';

@Component({
  selector: 'app-algorithm-info-card',
  standalone: true,
  imports: [CommonModule, CardModule, TagModule, TooltipModule],
  template: `
    <p-card>
      <ng-template #header>
        <div class="flex items-center justify-between p-4 pb-0">
          <h3 class="m-0 text-lg font-semibold">Algorithm Information</h3>
          @if (algorithm?.isFavorite) {
            <i class="pi pi-star-fill text-yellow-500" pTooltip="Favorited"></i>
          }
        </div>
      </ng-template>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="mb-1 block text-sm text-gray-500">Category</label>
          <p-tag [value]="getCategoryLabel()" [severity]="getCategorySeverity()"></p-tag>
        </div>

        <div>
          <label class="mb-1 block text-sm text-gray-500">Status</label>
          <p-tag [value]="getStatusLabel()" [severity]="getStatusSeverity()"></p-tag>
        </div>

        <div>
          <label class="mb-1 block text-sm text-gray-500">Evaluate</label>
          <p-tag
            [value]="algorithm?.evaluate ? 'Yes' : 'No'"
            [severity]="algorithm?.evaluate ? 'success' : 'secondary'"
          >
          </p-tag>
        </div>

        <div>
          <label class="mb-1 block text-sm text-gray-500">Weight</label>
          <span class="font-medium">{{ algorithm?.weight ?? '-' }}</span>
        </div>

        <div class="col-span-2">
          <label class="mb-1 block text-sm text-gray-500">Cron Schedule</label>
          <code class="rounded bg-gray-100 px-2 py-1 text-sm dark:bg-gray-800">{{ algorithm?.cron || '-' }}</code>
        </div>

        @if (algorithm?.version || algorithm?.author) {
          <div>
            <label class="mb-1 block text-sm text-gray-500">Version</label>
            <span class="font-medium">{{ algorithm?.version || '-' }}</span>
          </div>

          <div>
            <label class="mb-1 block text-sm text-gray-500">Author</label>
            <span class="font-medium">{{ algorithm?.author || '-' }}</span>
          </div>
        }

        @if (algorithm?.description) {
          <div class="col-span-2">
            <label class="mb-1 block text-sm text-gray-500">Description</label>
            <p class="m-0 text-sm leading-relaxed">{{ algorithm?.description }}</p>
          </div>
        }
      </div>
    </p-card>
  `
})
export class AlgorithmInfoCardComponent {
  @Input() algorithm?: Algorithm | null;

  getCategoryLabel(): string {
    if (!this.algorithm?.category) return 'Unknown';
    const labels: Record<AlgorithmCategory, string> = {
      [AlgorithmCategory.TECHNICAL]: 'Technical',
      [AlgorithmCategory.FUNDAMENTAL]: 'Fundamental',
      [AlgorithmCategory.SENTIMENT]: 'Sentiment',
      [AlgorithmCategory.HYBRID]: 'Hybrid',
      [AlgorithmCategory.CUSTOM]: 'Custom'
    };
    return labels[this.algorithm.category] || 'Unknown';
  }

  getCategorySeverity(): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    if (!this.algorithm?.category) return 'secondary';
    const severities: Record<AlgorithmCategory, 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'> = {
      [AlgorithmCategory.TECHNICAL]: 'info',
      [AlgorithmCategory.FUNDAMENTAL]: 'success',
      [AlgorithmCategory.SENTIMENT]: 'warn',
      [AlgorithmCategory.HYBRID]: 'contrast',
      [AlgorithmCategory.CUSTOM]: 'secondary'
    };
    return severities[this.algorithm.category];
  }

  getStatusLabel(): string {
    if (!this.algorithm?.status) return 'Unknown';
    const labels: Record<AlgorithmStatus, string> = {
      [AlgorithmStatus.ACTIVE]: 'Active',
      [AlgorithmStatus.INACTIVE]: 'Inactive',
      [AlgorithmStatus.MAINTENANCE]: 'Maintenance',
      [AlgorithmStatus.ERROR]: 'Error'
    };
    return labels[this.algorithm.status] || 'Unknown';
  }

  getStatusSeverity(): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    if (!this.algorithm?.status) return 'secondary';
    const severities: Record<AlgorithmStatus, 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast'> = {
      [AlgorithmStatus.ACTIVE]: 'success',
      [AlgorithmStatus.INACTIVE]: 'secondary',
      [AlgorithmStatus.MAINTENANCE]: 'warn',
      [AlgorithmStatus.ERROR]: 'danger'
    };
    return severities[this.algorithm.status];
  }
}
