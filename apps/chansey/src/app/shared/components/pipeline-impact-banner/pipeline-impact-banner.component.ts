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
              <strong>You have a strategy pipeline in progress.</strong>
              Settings changes apply to live trading immediately, but the in-flight pipeline will complete with its
              original configuration.
              @if (activeCount() > 1) {
                <span class="ml-1 font-medium">({{ activeCount() }} pipelines affected)</span>
              }
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
