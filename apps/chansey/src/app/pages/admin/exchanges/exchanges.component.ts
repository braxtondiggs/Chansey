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
import { ImageModule } from 'primeng/image';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule, Table } from 'primeng/table';
import { ToastModule } from 'primeng/toast';

import { Exchange, ExchangesService } from './exchanges.service';

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
export class ExchangesComponent {
  @ViewChild('dt') dt: Table | undefined;
  @ViewChild('searchInput') searchInput: ElementRef<HTMLInputElement> | undefined;

  // Services
  private readonly exchangesService = inject(ExchangesService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly fb = inject(FormBuilder).nonNullable;

  // State signals
  exchanges = signal<Exchange[]>([]);
  exchangeDialog = signal<boolean>(false);
  submitted = signal<boolean>(false);
  isNew = signal<boolean>(true);
  selectedExchanges = signal<Exchange[]>([]);
  searchFilter = signal<string>('');

  // Form
  exchangeForm: FormGroup = this.fb.group({
    name: ['', [Validators.required]],
    url: ['', Validators.compose([Validators.required, Validators.pattern(/^(http|https):\/\/[^ "]+$/)])],
    supported: [true]
  });

  exchangesQuery = this.exchangesService.useExchanges();
  createExchangeMutation = this.exchangesService.useCreateExchange();
  updateExchangeMutation = this.exchangesService.useUpdateExchange();
  deleteExchangeMutation = this.exchangesService.useDeleteExchange();

  // Computed states
  isLoading = computed(() => this.exchangesQuery?.isPending() || this.exchangesQuery?.isFetching());
  exchangesData = computed(() => this.exchangesQuery?.data() || []);
  isDeletePending = computed(() => this.deleteExchangeMutation?.isPending());
  isCreatePending = computed(() => this.createExchangeMutation?.isPending());
  isUpdatePending = computed(() => this.updateExchangeMutation?.isPending());
  hasChanges = computed(() => this.exchangeForm?.dirty || false);

  constructor() {
    this.initializeQueries();
  }

  private initializeQueries(): void {
    // Set up an effect to update the exchanges signal when query data changes
    effect(() => {
      const data = this.exchangesData();
      if (data && Array.isArray(data)) {
        this.exchanges.set(data);
      } else {
        this.exchanges.set([]);
      }
    });
  }

  openNewExchangeDialog(): void {
    this.isNew.set(true);
    this.submitted.set(false);
    this.exchangeForm.reset({
      supported: true
    });
    this.exchangeDialog.set(true);
  }

  openEditExchangeDialog(exchange: Exchange): void {
    this.isNew.set(false);
    this.submitted.set(false);
    this.exchangeForm.patchValue({
      name: exchange.name,
      url: exchange.url,
      supported: exchange.supported
    });

    this.exchangeDialog.set(true);
  }

  confirmDeleteExchange(exchange: Exchange): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete ${exchange.name}?`,
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary',
      accept: () => {
        this.deleteExchange(exchange.id);
      }
    });
  }

  hideDialog(): void {
    this.exchangeDialog.set(false);
    this.submitted.set(false);
    this.exchangeForm.reset();
  }

  saveExchange(): void {
    this.submitted.set(true);

    if (this.exchangeForm.invalid) {
      return;
    }

    const exchangeData = this.exchangeForm.value;

    if (this.isNew()) {
      // Generate slug on create only
      const slug = this.generateSlug(exchangeData.name);
      const createData = {
        ...exchangeData,
        slug
      };

      this.createExchangeMutation.mutate(createData, {
        onSuccess: () => {
          this.showSuccessMessage('Exchange created successfully');
          this.hideDialog();
        },
        onError: (error) => {
          this.showErrorMessage(error.message || 'Failed to create exchange');
        }
      });
    } else {
      // Find the exchange we're currently editing to get its ID
      const exchanges = this.exchanges();
      const matchingExchange = exchanges.find(
        (e) => e.name === exchangeData.name || (e.url === exchangeData.url && e.supported === exchangeData.supported)
      );

      if (!matchingExchange) {
        this.showErrorMessage('Could not find the exchange to update');
        return;
      }

      // Include the ID in the update data
      const updateData = {
        ...exchangeData,
        id: matchingExchange.id
      };

      this.updateExchangeMutation.mutate(updateData, {
        onSuccess: () => {
          this.showSuccessMessage('Exchange updated successfully');
          this.hideDialog();
        },
        onError: (error) => {
          this.showErrorMessage(error.message || 'Failed to update exchange');
        }
      });
    }
  }

  deleteExchange(id: string): void {
    console.log('Deleting exchange with ID:', id);
    this.deleteExchangeMutation.mutate(id, {
      onSuccess: () => {
        this.showSuccessMessage('Exchange deleted successfully');
      },
      onError: (error) => {
        this.showErrorMessage(error.message || 'Failed to delete exchange');
      }
    });
  }

  // Generate slug from name
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/--+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  applyGlobalFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    // Handle empty search better by using empty string instead of null/undefined
    const safeFilterValue = filterValue?.trim() ?? '';
    this.searchFilter.set(safeFilterValue);
    this.dt?.filterGlobal(safeFilterValue, 'contains');
  }

  clearSearch(): void {
    this.searchFilter.set('');
    this.dt?.filterGlobal('', 'contains');
    // Also clear the input field
    if (this.searchInput?.nativeElement) {
      this.searchInput.nativeElement.value = '';
    }
  }

  deleteSelectedExchanges(): void {
    this.confirmationService.confirm({
      message: 'Are you sure you want to delete the selected exchanges?',
      header: 'Confirm Multiple Delete',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary',
      accept: () => {
        const selected = this.selectedExchanges();
        if (!selected.length) return;

        Promise.all(selected.map((exchange) => this.deleteExchangeMutation.mutateAsync(exchange.id)))
          .then(() => {
            this.showSuccessMessage('Selected exchanges deleted successfully');
            this.selectedExchanges.set([]);
          })
          .catch((error) => {
            this.showErrorMessage('Failed to delete some exchanges');
            console.error('Error deleting selected exchanges:', error);
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
