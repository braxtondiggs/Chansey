import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

import { CardModule } from 'primeng/card';
import { PanelModule } from 'primeng/panel';
import { TagModule } from 'primeng/tag';

import { AlgorithmStrategy } from '@chansey/api-interfaces';

@Component({
  selector: 'app-strategy-card',
  standalone: true,
  imports: [CommonModule, CardModule, TagModule, PanelModule],
  template: `
    <p-card>
      <ng-template #header>
        <div class="flex items-center justify-between p-4 pb-0">
          <h3 class="m-0 text-lg font-semibold">Strategy</h3>
          @if (hasStrategy) {
            <p-tag value="Linked" severity="success"></p-tag>
          } @else {
            <p-tag value="No Strategy" severity="warn"></p-tag>
          }
        </div>
      </ng-template>

      @if (strategy) {
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="mb-1 block text-sm text-gray-500">Name</label>
              <span class="font-medium">{{ strategy.name }}</span>
            </div>

            <div>
              <label class="mb-1 block text-sm text-gray-500">Version</label>
              <code class="rounded bg-gray-100 px-2 py-1 text-sm dark:bg-gray-800">{{ strategy.version }}</code>
            </div>
          </div>

          @if (strategy.description) {
            <div>
              <label class="mb-1 block text-sm text-gray-500">Description</label>
              <p class="m-0 text-sm leading-relaxed">{{ strategy.description }}</p>
            </div>
          }

          @if (strategy.configSchema && hasConfigProperties()) {
            <div>
              <label class="mb-2 block text-sm text-gray-500">Configuration Schema</label>
              <p-panel [toggleable]="true" [collapsed]="true" header="View Schema">
                <pre class="m-0 overflow-auto rounded bg-gray-100 p-3 text-xs dark:bg-gray-800">{{
                  formatConfigSchema()
                }}</pre>
              </p-panel>
            </div>
          }
        </div>
      } @else {
        <div class="py-8 text-center">
          <i class="pi pi-exclamation-circle mb-3 text-4xl text-gray-400"></i>
          <p class="m-0 text-gray-500">No strategy is linked to this algorithm.</p>
          <p class="mt-1 text-sm text-gray-400">Assign a strategy to enable execution.</p>
        </div>
      }
    </p-card>
  `
})
export class StrategyCardComponent {
  @Input() strategy?: AlgorithmStrategy | null;
  @Input() hasStrategy: boolean = false;

  hasConfigProperties(): boolean {
    return !!this.strategy?.configSchema && Object.keys(this.strategy.configSchema).length > 0;
  }

  formatConfigSchema(): string {
    if (!this.strategy?.configSchema) return '{}';
    return JSON.stringify(this.strategy.configSchema, null, 2);
  }
}
