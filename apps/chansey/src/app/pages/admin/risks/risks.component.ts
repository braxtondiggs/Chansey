import { CommonModule } from '@angular/common';
import { Component, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

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

import { Risk, RisksService, CreateRiskDto, UpdateRiskDto } from './risks.service';

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
export class RisksComponent implements OnInit {
  @ViewChild('dt') dt: Table | undefined;

  risks: Risk[] = [];
  risk: Risk | null = null;
  riskDialog: boolean = false;
  riskForm: FormGroup;
  isLoading: boolean = false;
  submitted: boolean = false;
  isNew: boolean = true;
  selectedRisks: Risk[] = [];

  constructor(
    private risksService: RisksService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService,
    private fb: FormBuilder
  ) {
    this.riskForm = this.fb.group({
      name: ['', [Validators.required]],
      description: ['', [Validators.required]],
      level: [1, [Validators.required, Validators.min(1), Validators.max(5)]]
    });
  }

  ngOnInit(): void {
    this.loadRisks();
  }

  loadRisks(): void {
    this.isLoading = true;
    this.risksService.getRisks().subscribe({
      next: (data) => {
        this.risks = data;
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to load risk levels'
        });
        console.error('Error loading risk levels:', error);
        this.isLoading = false;
      }
    });
  }

  openNewRiskDialog(): void {
    this.risk = null;
    this.isNew = true;
    this.submitted = false;
    this.riskForm.reset({
      level: 1
    });
    this.riskDialog = true;
  }

  openEditRiskDialog(risk: Risk): void {
    this.risk = { ...risk };
    this.isNew = false;
    this.submitted = false;
    this.riskForm.patchValue({
      name: risk.name,
      description: risk.description,
      level: risk.level
    });
    this.riskDialog = true;
  }

  confirmDeleteRisk(risk: Risk): void {
    this.risk = risk;
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the risk level "${risk.name}"?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.deleteRisk();
      }
    });
  }

  hideDialog(): void {
    this.riskDialog = false;
    this.submitted = false;
    this.riskForm.reset();
  }

  saveRisk(): void {
    this.submitted = true;

    if (this.riskForm.invalid) {
      return;
    }

    const riskData = this.riskForm.value;

    if (this.isNew) {
      this.createRisk(riskData);
    } else if (this.risk) {
      this.updateRisk(this.risk.id, riskData);
    }
  }

  createRisk(riskData: CreateRiskDto): void {
    this.isLoading = true;
    this.risksService.createRisk(riskData).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Risk level created successfully'
        });
        this.loadRisks();
        this.hideDialog();
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to create risk level'
        });
        console.error('Error creating risk level:', error);
        this.isLoading = false;
      }
    });
  }

  updateRisk(id: string, riskData: UpdateRiskDto): void {
    this.isLoading = true;
    this.risksService.updateRisk(id, riskData).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Risk level updated successfully'
        });
        this.loadRisks();
        this.hideDialog();
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to update risk level'
        });
        console.error('Error updating risk level:', error);
        this.isLoading = false;
      }
    });
  }

  deleteRisk(): void {
    if (!this.risk) return;

    this.isLoading = true;
    this.risksService.deleteRisk(this.risk.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Risk level deleted successfully'
        });
        this.loadRisks();
        this.risk = null;
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to delete risk level'
        });
        console.error('Error deleting risk level:', error);
        this.isLoading = false;
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
        this.isLoading = true;
        const deleteObservables = this.selectedRisks.map((risk) => this.risksService.deleteRisk(risk.id));

        // Using Promise.all to handle multiple observables
        Promise.all(deleteObservables.map((obs) => obs.toPromise()))
          .then(() => {
            this.messageService.add({
              severity: 'success',
              summary: 'Success',
              detail: 'Risk levels deleted successfully'
            });
            this.selectedRisks = [];
            this.loadRisks();
            this.isLoading = false;
          })
          .catch((error) => {
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: 'Failed to delete some risk levels'
            });
            console.error('Error deleting risk levels:', error);
            this.isLoading = false;
          });
      }
    });
  }
}
