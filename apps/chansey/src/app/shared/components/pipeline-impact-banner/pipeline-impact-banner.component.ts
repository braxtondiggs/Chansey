import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { MessageModule } from 'primeng/message';

import { PipelineService } from '../../services/pipeline.service';

@Component({
  selector: 'app-pipeline-impact-banner',
  imports: [MessageModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hasActivePipeline()) {
      <p-message severity="info" class="mb-3 block">
        <ng-template #container>
          <div class="flex w-full items-start gap-2 p-3">
            <i class="pi pi-info-circle mt-1" aria-hidden="true"></i>
            <span>
              <strong>
                @if (activeCount() === 1) {
                  1 automated strategy is being evaluated.
                } @else {
                  {{ activeCount() }} automated strategies are being evaluated.
                }
              </strong>
              Settings changes apply to live trading immediately, but these evaluations will finish with their original
              configuration.
            </span>
          </div>
        </ng-template>
      </p-message>
    }
  `
})
export class PipelineImpactBannerComponent {
  private readonly pipelineService = inject(PipelineService);
  private readonly statusQuery = this.pipelineService.usePipelineActiveStatus();

  readonly hasActivePipeline = computed(() => this.statusQuery.data()?.hasActivePipeline ?? false);
  readonly activeCount = computed(() => this.statusQuery.data()?.activeCount ?? 0);
}
