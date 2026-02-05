import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { SelectModule } from 'primeng/select';

import { PaginatedAlgorithmListDto } from '../../live-trade-monitoring.service';

@Component({
  selector: 'app-algorithm-selector',
  standalone: true,
  imports: [CommonModule, FormsModule, SelectModule],
  template: `
    <div class="flex items-center gap-4">
      <label class="font-medium">Select Algorithm:</label>
      <p-select
        [ngModel]="selectedAlgorithmId"
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
  @Input() algorithms: PaginatedAlgorithmListDto | undefined;
  @Input() selectedAlgorithmId: string | null = null;
  @Output() selectionChange = new EventEmitter<string | null>();

  get algorithmOptions(): { label: string; value: string }[] {
    if (!this.algorithms?.data) return [];

    // Create unique algorithm options (dedupe by algorithmId)
    const uniqueAlgorithms = new Map<string, string>();
    for (const activation of this.algorithms.data) {
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
