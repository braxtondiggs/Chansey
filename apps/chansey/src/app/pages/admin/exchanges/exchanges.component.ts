import { CommonModule } from '@angular/common';
import { Component, OnInit, ViewChild } from '@angular/core';
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
import { ImageModule } from 'primeng/image';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule, Table } from 'primeng/table';
import { ToastModule } from 'primeng/toast';

import { Exchange, ExchangesService, CreateExchangeDto, UpdateExchangeDto } from './exchanges.service';

@Component({
  selector: 'app-exchanges',
  standalone: true,
  imports: [
    ButtonModule,
    CardModule,
    CommonModule,
    CheckboxModule,
    ConfirmDialogModule,
    DialogModule,
    FloatLabelModule,
    FluidModule,
    FormsModule,
    IconFieldModule,
    ImageModule,
    InputIconModule,
    InputTextModule,
    ReactiveFormsModule,
    TableModule,
    ToastModule
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './exchanges.component.html'
})
export class ExchangesComponent implements OnInit {
  @ViewChild('dt') dt: Table | undefined;

  exchanges: Exchange[] = [];
  exchange: Exchange | null = null;
  exchangeDialog: boolean = false;
  exchangeForm: FormGroup;
  isLoading: boolean = false;
  isSyncing: boolean = false;
  submitted: boolean = false;
  isNew: boolean = true;
  selectedExchanges: Exchange[] = [];

  constructor(
    private exchangesService: ExchangesService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService,
    private fb: FormBuilder
  ) {
    this.exchangeForm = this.fb.group({
      name: ['', [Validators.required]],
      url: ['', [Validators.required, Validators.pattern(/^(http|https):\/\/[^ "]+$/)]],
      supported: [true]
    });
  }

  ngOnInit(): void {
    this.loadExchanges();
  }

  loadExchanges(): void {
    this.isLoading = true;
    this.exchangesService.getExchanges().subscribe({
      next: (data) => {
        this.exchanges = data;
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to load exchanges'
        });
        console.error('Error loading exchanges:', error);
        this.isLoading = false;
      }
    });
  }

  openNewExchangeDialog(): void {
    this.exchange = null;
    this.isNew = true;
    this.submitted = false;
    this.exchangeForm.reset({
      supported: true
    });
    this.exchangeDialog = true;
  }

  openEditExchangeDialog(exchange: Exchange): void {
    this.exchange = { ...exchange };
    this.isNew = false;
    this.submitted = false;
    this.exchangeForm.patchValue({
      name: exchange.name,
      url: exchange.url,
      supported: exchange.supported
    });
    this.exchangeDialog = true;
  }

  confirmDeleteExchange(exchange: Exchange): void {
    this.exchange = exchange;
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the exchange "${exchange.name}"?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.deleteExchange();
      }
    });
  }

  hideDialog(): void {
    this.exchangeDialog = false;
    this.submitted = false;
    this.exchangeForm.reset();
  }

  saveExchange(): void {
    this.submitted = true;

    if (this.exchangeForm.invalid) {
      return;
    }

    const exchangeData = this.exchangeForm.value;

    if (this.isNew) {
      this.createExchange(exchangeData);
    } else if (this.exchange) {
      this.updateExchange(this.exchange.id, exchangeData);
    }
  }

  createExchange(exchangeData: CreateExchangeDto): void {
    this.isLoading = true;
    this.exchangesService.createExchange(exchangeData).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Exchange created successfully'
        });
        this.loadExchanges();
        this.hideDialog();
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to create exchange'
        });
        console.error('Error creating exchange:', error);
        this.isLoading = false;
      }
    });
  }

  updateExchange(id: string, exchangeData: UpdateExchangeDto): void {
    this.isLoading = true;
    this.exchangesService.updateExchange(id, exchangeData).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Exchange updated successfully'
        });
        this.loadExchanges();
        this.hideDialog();
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to update exchange'
        });
        console.error('Error updating exchange:', error);
        this.isLoading = false;
      }
    });
  }

  deleteExchange(): void {
    if (!this.exchange) return;

    this.isLoading = true;
    this.exchangesService.deleteExchange(this.exchange.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Exchange deleted successfully'
        });
        this.loadExchanges();
        this.exchange = null;
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to delete exchange'
        });
        console.error('Error deleting exchange:', error);
        this.isLoading = false;
      }
    });
  }

  applyGlobalFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    if (this.dt) {
      this.dt.filterGlobal(filterValue, 'contains');
    }
  }

  deleteSelectedExchanges(): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the selected exchanges?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.isLoading = true;
        const deleteObservables = this.selectedExchanges.map((exchange) =>
          this.exchangesService.deleteExchange(exchange.id)
        );

        // Using Promise.all to handle multiple observables
        Promise.all(deleteObservables.map((obs) => obs.toPromise()))
          .then(() => {
            this.messageService.add({
              severity: 'success',
              summary: 'Success',
              detail: 'Exchanges deleted successfully'
            });
            this.selectedExchanges = [];
            this.loadExchanges();
            this.isLoading = false;
          })
          .catch((error) => {
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: 'Failed to delete some exchanges'
            });
            console.error('Error deleting exchanges:', error);
            this.isLoading = false;
          });
      }
    });
  }

  syncExchanges(): void {
    this.isSyncing = true;
    this.exchangesService.syncExchanges().subscribe({
      next: (response) => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: response.message || 'Exchanges synced successfully'
        });
        this.loadExchanges();
        this.isSyncing = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to sync exchanges'
        });
        console.error('Error syncing exchanges:', error);
        this.isSyncing = false;
      }
    });
  }
}
