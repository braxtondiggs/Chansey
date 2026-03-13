import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { AutoSaveStatus } from '../../utils/auto-save';

@Component({
  selector: 'app-save-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (status()) {
      @case ('saving') {
        <span class="text-muted-color inline-flex items-center gap-1 text-xs">
          <i class="pi pi-spin pi-spinner text-xs"></i> Saving...
        </span>
      }
      @case ('saved') {
        <span class="inline-flex items-center gap-1 text-xs text-green-500">
          <i class="pi pi-check text-xs"></i> Saved
        </span>
      }
      @case ('error') {
        <span class="inline-flex items-center gap-1 text-xs text-red-500">
          <i class="pi pi-times text-xs"></i> Failed
        </span>
      }
    }
  `
})
export class SaveStatusIndicatorComponent {
  status = input.required<AutoSaveStatus>();
}
