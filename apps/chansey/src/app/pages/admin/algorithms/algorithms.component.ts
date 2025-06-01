import { CommonModule } from '@angular/common';
import { Component, ViewChild, ElementRef, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { CheckboxModule } from 'primeng/checkbox';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { FloatLabelModule } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { Table, TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';

import { Algorithm } from '@chansey/api-interfaces';

import { AlgorithmsService } from './algorithms.service';

@Component({
  selector: 'app-algorithms',
  standalone: true,
  imports: [
    ButtonModule,
    CardModule,
    CheckboxModule,
    CommonModule,
    ConfirmDialogModule,
    DialogModule,
    FloatLabelModule,
    FluidModule,
    FormsModule,
    IconFieldModule,
    InputIconModule,
    InputNumberModule,
    InputTextModule,
    ReactiveFormsModule,
    TableModule,
    TagModule,
    TextareaModule,
    ToastModule
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './algorithms.component.html'
})
export class AlgorithmsComponent {
  @ViewChild('dt') dt!: Table;
  @ViewChild('searchInput') searchInput: ElementRef<HTMLInputElement> | undefined;

  // State signals
  algorithms = signal<Algorithm[]>([]);
  algorithmDialog = signal<boolean>(false);
  submitted = signal<boolean>(false);
  isNew = signal<boolean>(true);
  selectedAlgorithms = signal<Algorithm[]>([]);
  searchFilter = signal<string>('');

  // Dependencies
  private algorithmsService = inject(AlgorithmsService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private fb = inject(FormBuilder);

  // Form
  algorithmForm: FormGroup = this.fb.group({
    name: ['', [Validators.required]],
    description: [''],
    service: [''],
    status: [false],
    evaluate: [true],
    cron: [
      '* * * * *',
      [Validators.required, Validators.pattern(/^(\*|[0-9]+) (\*|[0-9]+) (\*|[0-9]+) (\*|[0-9]+) (\*|[0-9]+)$/)]
    ]
  });

  // TanStack Query hooks
  algorithmsQuery = this.algorithmsService.useAlgorithms();
  createAlgorithmMutation = this.algorithmsService.useCreateAlgorithm();
  updateAlgorithmMutation = this.algorithmsService.useUpdateAlgorithm();
  deleteAlgorithmMutation = this.algorithmsService.useDeleteAlgorithm();

  // Computed states
  isLoading = computed(() => this.algorithmsQuery.isPending() || this.algorithmsQuery.isFetching());
  algorithmsData = computed(() => this.algorithmsQuery.data() || []);
  isDeletePending = computed(() => this.deleteAlgorithmMutation.isPending());
  isCreatePending = computed(() => this.createAlgorithmMutation.isPending());
  isUpdatePending = computed(() => this.updateAlgorithmMutation.isPending());
  hasChanges = computed(() => this.algorithmForm?.dirty || false);

  constructor() {
    this.initializeQueries();
  }

  private initializeQueries(): void {
    // Set up an effect to update the algorithms signal when query data changes
    effect(() => {
      const data = this.algorithmsData();
      if (data && Array.isArray(data)) {
        this.algorithms.set(data);
      }
    });
  }

  openNewAlgorithmDialog(): void {
    this.isNew.set(true);
    this.submitted.set(false);
    this.algorithmForm.reset({
      status: false,
      evaluate: true,
      cron: '* * * * *'
    });
    this.algorithmDialog.set(true);
  }

  openEditAlgorithmDialog(algorithm: Algorithm): void {
    this.isNew.set(false);
    this.submitted.set(false);
    this.algorithmForm.patchValue({
      name: algorithm.name,
      description: algorithm.description || '',
      service: algorithm.service || '',
      status: algorithm.status,
      evaluate: algorithm.evaluate,
      cron: algorithm.cron
    });

    this.algorithmDialog.set(true);
  }

  confirmDeleteAlgorithm(algorithm: Algorithm): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete ${algorithm.name}?`,
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary',
      accept: () => {
        this.deleteAlgorithm(algorithm.id);
      }
    });
  }

  hideDialog(): void {
    this.algorithmDialog.set(false);
    this.submitted.set(false);
    this.algorithmForm.reset();
  }

  saveAlgorithm(): void {
    this.submitted.set(true);

    if (this.algorithmForm.invalid) {
      return;
    }

    const algorithmData = this.algorithmForm.value;

    if (this.isNew()) {
      this.createAlgorithmMutation.mutate(algorithmData, {
        onSuccess: () => {
          this.showSuccessMessage('Algorithm created successfully');
          this.hideDialog();
        },
        onError: (error) => {
          this.showErrorMessage(error.message || 'Failed to create algorithm');
        }
      });
    } else {
      // Find the algorithm we're currently editing to get its ID
      const algorithms = this.algorithms();
      const matchingAlgorithm = algorithms.find((a) => a.name === algorithmData.name);

      if (!matchingAlgorithm) {
        this.showErrorMessage('Could not find the algorithm to update');
        return;
      }

      // Include the ID in the update data
      const updateData = {
        ...algorithmData,
        id: matchingAlgorithm.id
      };

      this.updateAlgorithmMutation.mutate(updateData, {
        onSuccess: () => {
          this.showSuccessMessage('Algorithm updated successfully');
          this.hideDialog();
        },
        onError: (error) => {
          this.showErrorMessage(error.message || 'Failed to update algorithm');
        }
      });
    }
  }

  deleteAlgorithm(id: string): void {
    this.deleteAlgorithmMutation.mutate(id, {
      onSuccess: () => {
        this.showSuccessMessage('Algorithm deleted successfully');
      },
      onError: (error) => {
        this.showErrorMessage(error.message || 'Failed to delete algorithm');
      }
    });
  }

  deleteSelectedAlgorithms(): void {
    this.confirmationService.confirm({
      message: 'Are you sure you want to delete the selected algorithms?',
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary',
      accept: () => {
        const selected = this.selectedAlgorithms();
        selected.forEach((algorithm) => {
          this.deleteAlgorithm(algorithm.id);
        });
        this.selectedAlgorithms.set([]);
      }
    });
  }

  onSelectionChange(selection: Algorithm[]): void {
    this.selectedAlgorithms.set(selection);
  }

  applyGlobalFilter(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchFilter.set(value);
    this.dt.filterGlobal(value, 'contains');
  }

  getStatusSeverity(status: boolean): 'success' | 'secondary' {
    return status ? 'success' : 'secondary';
  }

  getEvaluateSeverity(evaluate: boolean): 'info' | 'secondary' {
    return evaluate ? 'info' : 'secondary';
  }

  private showSuccessMessage(detail: string): void {
    this.messageService.add({
      severity: 'success',
      summary: 'Success',
      detail
    });
  }

  private showErrorMessage(detail: string): void {
    this.messageService.add({
      severity: 'error',
      summary: 'Error',
      detail
    });
  }
}
