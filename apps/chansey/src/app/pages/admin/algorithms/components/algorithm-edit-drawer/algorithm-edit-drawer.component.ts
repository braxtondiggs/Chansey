import { Component, EventEmitter, inject, Input, Output, signal } from '@angular/core';
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

  @Input() set visible(value: boolean) {
    this._visible.set(value);
  }
  get visible(): boolean {
    return this._visible();
  }

  @Input() algorithm: Algorithm | null = null;
  @Input() strategies: AlgorithmStrategy[] = [];
  @Input() isLoading = false;

  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() save = new EventEmitter<AlgorithmDrawerSaveEvent>();

  private _visible = signal<boolean>(false);
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
    return !this.algorithm;
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
    this._visible.set(true);
    this.visibleChange.emit(true);
  }

  openForEdit(algorithm: Algorithm | AlgorithmDetailResponse): void {
    const strategy = this.strategies.find((s) => s.className === algorithm.service);
    this.selectedStrategy.set(strategy || null);

    this.algorithmForm.patchValue({
      name: algorithm.name,
      description: algorithm.description || '',
      strategyId: strategy?.id || null,
      category: algorithm.category || AlgorithmCategory.TECHNICAL,
      status: algorithm.status || AlgorithmStatus.INACTIVE,
      evaluate: algorithm.evaluate,
      cron: algorithm.cron,
      version: algorithm.version || '',
      author: algorithm.author || ''
    });

    this.submitted.set(false);
    this._visible.set(true);
    this.visibleChange.emit(true);
  }

  hideDrawer(): void {
    this._visible.set(false);
    this.visibleChange.emit(false);
    this.submitted.set(false);
    this.selectedStrategy.set(null);
    this.algorithmForm.reset();
  }

  onVisibleChange(visible: boolean): void {
    this._visible.set(visible);
    this.visibleChange.emit(visible);
    if (!visible) {
      this.submitted.set(false);
      this.selectedStrategy.set(null);
    }
  }

  onStrategyChange(strategyId: string | null): void {
    if (!strategyId) {
      this.selectedStrategy.set(null);
      return;
    }
    const strategy = this.strategies.find((s) => s.id === strategyId);
    this.selectedStrategy.set(strategy || null);
  }

  saveAlgorithm(): void {
    this.submitted.set(true);

    if (this.algorithmForm.invalid) {
      return;
    }

    const formData = this.algorithmForm.value;
    const selectedStrategy = this.strategies.find((s) => s.id === formData.strategyId);

    const algorithmData = {
      ...formData,
      service: selectedStrategy?.className || null
    };

    this.save.emit({
      id: this.algorithm?.id || null,
      data: algorithmData
    });
  }
}
