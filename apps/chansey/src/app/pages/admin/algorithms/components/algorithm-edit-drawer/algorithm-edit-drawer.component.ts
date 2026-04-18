import { Component, effect, inject, input, model, output, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { DividerModule } from 'primeng/divider';
import { DrawerModule } from 'primeng/drawer';
import { FieldsetModule } from 'primeng/fieldset';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TextareaModule } from 'primeng/textarea';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import {
  Algorithm,
  AlgorithmCategory,
  AlgorithmDetailResponse,
  AlgorithmDrawerSaveEvent,
  AlgorithmStatus,
  AlgorithmStrategy
} from '@chansey/api-interfaces';

@Component({
  selector: 'app-algorithm-edit-drawer',
  standalone: true,
  imports: [
    ButtonModule,
    DividerModule,
    DrawerModule,
    FieldsetModule,
    FormsModule,
    InputTextModule,
    ReactiveFormsModule,
    SelectModule,
    TextareaModule,
    ToggleSwitchModule
  ],
  templateUrl: './algorithm-edit-drawer.component.html'
})
export class AlgorithmEditDrawerComponent {
  private fb = inject(FormBuilder);

  constructor() {
    effect(() => {
      if (!this.visible()) {
        this.submitted.set(false);
        this.selectedStrategy.set(null);
      }
    });
  }

  readonly visible = model(false);
  readonly algorithm = input<Algorithm | null>(null);
  readonly strategies = input<AlgorithmStrategy[]>([]);
  readonly isLoading = input(false);

  readonly save = output<AlgorithmDrawerSaveEvent>();
  submitted = signal<boolean>(false);
  selectedStrategy = signal<AlgorithmStrategy | null>(null);

  algorithmForm: FormGroup = this.fb.group({
    name: ['', [Validators.required]],
    description: [''],
    strategyId: [null],
    category: [AlgorithmCategory.TECHNICAL],
    status: [AlgorithmStatus.INACTIVE],
    evaluate: [true],
    cron: [
      '0 */4 * * *',
      [Validators.required, Validators.pattern(/^([0-9*,/-]+) ([0-9*,/-]+) ([0-9*,/-]+) ([0-9*,/-]+) ([0-9*,/-]+)$/)]
    ],
    version: [''],
    author: ['']
  });

  categoryOptions = [
    { label: 'Technical Analysis', value: AlgorithmCategory.TECHNICAL },
    { label: 'Fundamental Analysis', value: AlgorithmCategory.FUNDAMENTAL },
    { label: 'Sentiment Analysis', value: AlgorithmCategory.SENTIMENT },
    { label: 'Hybrid', value: AlgorithmCategory.HYBRID },
    { label: 'Custom', value: AlgorithmCategory.CUSTOM }
  ];

  statusOptions = [
    { label: 'Inactive', value: AlgorithmStatus.INACTIVE },
    { label: 'Active', value: AlgorithmStatus.ACTIVE },
    { label: 'Maintenance', value: AlgorithmStatus.MAINTENANCE },
    { label: 'Error', value: AlgorithmStatus.ERROR }
  ];

  get isNew(): boolean {
    return !this.algorithm();
  }

  get drawerTitle(): string {
    return this.isNew ? 'Create Algorithm' : 'Edit Algorithm';
  }

  openForCreate(): void {
    this.algorithmForm.reset({
      strategyId: null,
      category: AlgorithmCategory.TECHNICAL,
      status: AlgorithmStatus.INACTIVE,
      evaluate: true,
      cron: '0 */4 * * *',
      version: '',
      author: ''
    });
    this.submitted.set(false);
    this.selectedStrategy.set(null);
    this.visible.set(true);
  }

  openForEdit(algo: Algorithm | AlgorithmDetailResponse): void {
    const strategy = this.strategies().find((s) => s.className === algo.service);
    this.selectedStrategy.set(strategy || null);

    this.algorithmForm.patchValue({
      name: algo.name,
      description: algo.description || '',
      strategyId: strategy?.id || null,
      category: algo.category || AlgorithmCategory.TECHNICAL,
      status: algo.status || AlgorithmStatus.INACTIVE,
      evaluate: algo.evaluate,
      cron: algo.cron,
      version: algo.version || '',
      author: algo.author || ''
    });

    this.submitted.set(false);
    this.visible.set(true);
  }

  hideDrawer(): void {
    this.visible.set(false);
    this.submitted.set(false);
    this.selectedStrategy.set(null);
    this.algorithmForm.reset();
  }

  onStrategyChange(strategyId: string | null): void {
    if (!strategyId) {
      this.selectedStrategy.set(null);
      return;
    }
    const strategy = this.strategies().find((s) => s.id === strategyId);
    this.selectedStrategy.set(strategy || null);
  }

  saveAlgorithm(): void {
    this.submitted.set(true);

    if (this.algorithmForm.invalid) {
      return;
    }

    const formData = this.algorithmForm.value;
    const selectedStrategy = this.strategies().find((s) => s.id === formData.strategyId);

    const algorithmData = {
      ...formData,
      service: selectedStrategy?.className || null
    };

    this.save.emit({
      id: this.algorithm()?.id || null,
      data: algorithmData
    });
  }
}
