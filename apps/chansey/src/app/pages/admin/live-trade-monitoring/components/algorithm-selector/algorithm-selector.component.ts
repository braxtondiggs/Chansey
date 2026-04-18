import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { SelectModule } from 'primeng/select';

import { PaginatedAlgorithmListDto } from '../../live-trade-monitoring.types';

@Component({
  selector: 'app-algorithm-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SelectModule],
  template: `
    <div class="flex items-center gap-4">
      <label class="font-medium">Select Algorithm:</label>
      <p-select
        [ngModel]="selectedAlgorithmId()"
        [options]="algorithmOptions"
        optionLabel="label"
        optionValue="value"
        placeholder="Choose an algorithm"
        [showClear]="true"
        [filter]="true"
        filterPlaceholder="Search algorithms..."
        styleClass="w-80"
        (onChange)="onSelect($event)"
      />
    </div>
  `
})
export class AlgorithmSelectorComponent {
  readonly algorithms = input<PaginatedAlgorithmListDto>();
  readonly selectedAlgorithmId = input<string | null>(null);
  selectionChange = output<string | null>();

  get algorithmOptions(): { label: string; value: string }[] {
    const data = this.algorithms()?.data;
    if (!data) return [];

    // Create unique algorithm options (dedupe by algorithmId)
    const uniqueAlgorithms = new Map<string, string>();
    for (const activation of data) {
      if (!uniqueAlgorithms.has(activation.algorithmId)) {
        uniqueAlgorithms.set(activation.algorithmId, activation.algorithmName);
      }
    }

    return Array.from(uniqueAlgorithms.entries()).map(([id, name]) => ({
      label: name,
      value: id
    }));
  }

  onSelect(event: { value: string | null }): void {
    this.selectionChange.emit(event.value);
  }
}
