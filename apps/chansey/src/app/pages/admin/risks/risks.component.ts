import { CommonModule } from '@angular/common';
import { Component, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { FloatLabelModule } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule, Table } from 'primeng/table';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';

import { CreateRisk, Risk, UpdateRisk } from '@chansey/api-interfaces';

import { RisksService } from './risks.service';

@Component({
  selector: 'app-risks',
  standalone: true,
  imports: [
    ButtonModule,
    CardModule,
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
    TextareaModule,
    ToastModule
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './risks.component.html'
})
export class RisksComponent {
  @ViewChild('dt') dt: Table | undefined;

  // State signals
  risks = signal<Risk[]>([]);
  riskDialog = signal<boolean>(false);
  submitted = signal<boolean>(false);
  isNew = signal<boolean>(true);
  selectedRisks = signal<Risk[]>([]);
  currentRiskId = signal<string | null>(null);

  // Services via inject
  private risksService = inject(RisksService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private fb = inject(FormBuilder).nonNullable;

  // Form
  riskForm = this.fb.group({
    name: ['', [Validators.required]],
    description: ['', [Validators.required]],
    level: [1, Validators.compose([Validators.required, Validators.min(1), Validators.max(5)])]
  });

  // TanStack Query hooks
  risksQuery = this.risksService.useRisks();
  createRiskMutation = this.risksService.useCreateRisk();
  updateRiskMutation = this.risksService.useUpdateRisk();
  deleteRiskMutation = this.risksService.useDeleteRisk();

  // Computed state
  isLoading = computed(() => this.risksQuery.isPending() || this.risksQuery.isFetching());
  risksData = computed(() => this.risksQuery.data() || []);
  risksError = computed(() => this.risksQuery.error);
  isDeletePending = computed(() => this.deleteRiskMutation.isPending());
  isCreatePending = computed(() => this.createRiskMutation.isPending());
  isUpdatePending = computed(() => this.updateRiskMutation.isPending());
  hasChanges = computed(() => this.riskForm?.dirty || false);

  constructor() {
    // Set up an effect to update the risks signal when query data changes
    effect(() => {
      const data = this.risksData();
      if (data && Array.isArray(data)) {
        this.risks.set(data);
      }
    });
  }

  openNewRiskDialog(): void {
    this.isNew.set(true);
    this.submitted.set(false);
    this.riskForm.reset({
      level: 1
    });
    this.riskDialog.set(true);
  }

  openEditRiskDialog(risk: Risk): void {
    this.isNew.set(false);
    this.submitted.set(false);
    this.currentRiskId.set(risk.id);
    this.riskForm.patchValue({
      name: risk.name,
      description: risk.description,
      level: risk.level
    });
    this.riskDialog.set(true);
  }

  confirmDeleteRisk(risk: Risk): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the risk level "${risk.name}"?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary',
      accept: () => {
        this.deleteRisk(risk.id);
      }
    });
  }

  hideDialog(): void {
    this.riskDialog.set(false);
    this.submitted.set(false);
    this.riskForm.reset();
    this.currentRiskId.set(null);
  }

  saveRisk(): void {
    this.submitted.set(true);

    if (this.riskForm.invalid) {
      return;
    }

    const riskData = this.riskForm.value;

    if (this.isNew()) {
      this.createRisk(riskData as CreateRisk);
    } else {
      this.updateRisk(riskData as UpdateRisk);
    }
  }

  createRisk(riskData: CreateRisk): void {
    this.createRiskMutation.mutate(riskData, {
      onSuccess: () => {
        this.showSuccessMessage('Risk level created successfully');
        this.hideDialog();
      },
      onError: (error) => {
        this.showErrorMessage(error.message || 'Failed to create risk level');
      }
    });
  }

  updateRisk(riskData: UpdateRisk): void {
    const riskId = this.currentRiskId();
    if (!riskId) {
      this.showErrorMessage('Could not find the risk level to update');
      return;
    }

    const updateData = {
      ...riskData,
      id: riskId
    };

    this.updateRiskMutation.mutate(updateData, {
      onSuccess: () => {
        this.showSuccessMessage('Risk level updated successfully');
        this.hideDialog();
      },
      onError: (error) => {
        this.showErrorMessage(error.message || 'Failed to update risk level');
      }
    });
  }

  deleteRisk(id: string): void {
    this.deleteRiskMutation.mutate(id, {
      onSuccess: () => {
        this.showSuccessMessage('Risk level deleted successfully');
      },
      onError: (error) => {
        this.showErrorMessage(error.message || 'Failed to delete risk level');
      }
    });
  }

  getRiskLevelLabel(level: number): string {
    switch (level) {
      case 1:
        return 'Very Low';
      case 2:
        return 'Low';
      case 3:
        return 'Medium';
      case 4:
        return 'High';
      case 5:
        return 'Very High';
      default:
        return 'Unknown';
    }
  }

  applyGlobalFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    if (this.dt) {
      this.dt.filterGlobal(filterValue, 'contains');
    }
  }

  deleteSelectedRisks(): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the selected risk levels?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        const selected = this.selectedRisks();
        if (!selected.length) return;

        Promise.all(selected.map((risk) => this.deleteRiskMutation.mutateAsync(risk.id)))
          .then(() => {
            this.showSuccessMessage('Selected risk levels deleted successfully');
            this.selectedRisks.set([]);
          })
          .catch((error) => {
            this.showErrorMessage('Failed to delete some risk levels');
            console.error('Error deleting risk levels:', error);
          });
      }
    });
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
