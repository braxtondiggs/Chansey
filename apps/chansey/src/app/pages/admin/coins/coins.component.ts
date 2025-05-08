import { CommonModule } from '@angular/common';
import { Component, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';

import { ConfirmationService, MessageService, MenuItem } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogModule } from 'primeng/dialog';
import { FloatLabelModule } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { IconFieldModule } from 'primeng/iconfield';
import { ImageModule } from 'primeng/image';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { SplitButtonModule } from 'primeng/splitbutton';
import { TableModule, Table } from 'primeng/table';
import { ToastModule } from 'primeng/toast';

import { Coin, CoinsService } from './coins.service';

@Component({
  selector: 'app-coins',
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
    ImageModule,
    InputIconModule,
    InputTextModule,
    ReactiveFormsModule,
    SplitButtonModule,
    TableModule,
    ToastModule
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './coins.component.html'
})
export class CoinsComponent {
  @ViewChild('dt') dt: Table | undefined;

  // Services
  private readonly coinsService = inject(CoinsService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly fb = inject(FormBuilder).nonNullable;

  // State signals
  coins = signal<Coin[]>([]);
  coinDialog = signal<boolean>(false);
  submitted = signal<boolean>(false);
  isNew = signal<boolean>(true);
  selectedCoins = signal<Coin[]>([]);

  // Form
  coinForm: FormGroup = this.fb.group({
    name: ['', [Validators.required]],
    symbol: ['', [Validators.required]],
    slug: ['']
  });

  // TanStack Query hooks
  coinsQuery = this.coinsService.useCoins();
  syncCoinsMutation = this.coinsService.useSyncCoins();
  syncCoinDetailsMutation = this.coinsService.useSyncCoinDetails();
  createCoinMutation = this.coinsService.useCreateCoin();
  updateCoinMutation = this.coinsService.useUpdateCoin();
  deleteCoinMutation = this.coinsService.useDeleteCoin();

  // Computed states
  isLoading = computed(() => this.coinsQuery?.isPending() || this.coinsQuery?.isFetching());
  isSyncingCoins = computed(() => this.syncCoinsMutation?.isPending());
  isSyncingDetails = computed(() => this.syncCoinDetailsMutation?.isPending());
  coinsData = computed(() => this.coinsQuery?.data() || []);
  coinsError = computed(() => this.coinsQuery?.error);
  isDeletePending = computed(() => this.deleteCoinMutation?.isPending());
  isCreatePending = computed(() => this.createCoinMutation?.isPending());
  isUpdatePending = computed(() => this.updateCoinMutation?.isPending());
  hasChanges = computed(() => this.coinForm?.dirty || false);

  // Computed menu properties
  syncLabel = computed(() => (this.isSyncingCoins() ? 'Syncing...' : 'Sync'));
  syncIcon = computed(() => (this.isSyncingCoins() ? 'pi pi-spin pi-spinner' : 'pi pi-refresh'));
  syncItems = computed(() => {
    return [
      {
        label: this.isSyncingDetails() ? 'Syncing Details...' : 'Sync Detailed Info',
        icon: this.isSyncingDetails() ? 'pi pi-spin pi-spinner' : 'pi pi-list',
        disabled: this.isSyncingCoins() || this.isSyncingDetails(),
        command: () => {
          this.syncCoinDetails();
        }
      }
    ];
  });

  constructor() {
    this.initializeQueries();
  }

  private initializeQueries(): void {
    // Set up an effect to update the coins signal when query data changes
    effect(() => {
      const data = this.coinsData();
      if (data && Array.isArray(data)) {
        this.coins.set(data);
      }
    });
  }

  openNewCoinDialog(): void {
    this.isNew.set(true);
    this.submitted.set(false);
    this.coinForm.reset();
    this.coinDialog.set(true);
  }

  openEditCoinDialog(coin: Coin): void {
    this.isNew.set(false);
    this.submitted.set(false);
    this.coinForm.patchValue({
      name: coin.name,
      symbol: coin.symbol,
      slug: coin.slug
    });
    this.coinDialog.set(true);
  }

  confirmDeleteCoin(coin: Coin): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the coin "${coin.name}"?`,
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary',
      accept: () => {
        this.deleteCoin(coin.id);
      }
    });
  }

  hideDialog(): void {
    this.coinDialog.set(false);
    this.submitted.set(false);
    this.coinForm.reset();
  }

  saveCoin(): void {
    this.submitted.set(true);

    if (this.coinForm.invalid) {
      return;
    }

    const coinData = this.coinForm.value;

    if (this.isNew()) {
      // Generate slug if not provided
      const slug = coinData.slug || this.generateSlug(coinData.name);
      const createData = {
        ...coinData,
        slug
      };

      this.createCoinMutation.mutate(createData, {
        onSuccess: () => {
          this.showSuccessMessage('Coin created successfully');
          this.hideDialog();
        },
        onError: (error) => {
          this.showErrorMessage(error.message || 'Failed to create coin');
        }
      });
    } else {
      // Find the coin we're currently editing to get its ID
      const coins = this.coins();
      const matchingCoin = coins.find((c) => c.name === coinData.name || c.symbol === coinData.symbol);

      if (!matchingCoin) {
        this.showErrorMessage('Could not find the coin to update');
        return;
      }

      // Include the ID in the update data
      const updateData = {
        ...coinData,
        id: matchingCoin.id
      };

      this.updateCoinMutation.mutate(updateData, {
        onSuccess: () => {
          this.showSuccessMessage('Coin updated successfully');
          this.hideDialog();
        },
        onError: (error) => {
          this.showErrorMessage(error.message || 'Failed to update coin');
        }
      });
    }
  }

  deleteCoin(id: string): void {
    this.deleteCoinMutation.mutate(id, {
      onSuccess: () => {
        this.showSuccessMessage('Coin deleted successfully');
      },
      onError: (error) => {
        this.showErrorMessage(error.message || 'Failed to delete coin');
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
    this.dt?.filterGlobal(filterValue, 'contains');
  }

  deleteSelectedCoins(): void {
    this.confirmationService.confirm({
      message: 'Are you sure you want to delete the selected coins?',
      header: 'Confirm Multiple Delete',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary',
      accept: () => {
        const selected = this.selectedCoins();
        if (!selected.length) return;

        Promise.all(selected.map((coin) => this.deleteCoinMutation.mutateAsync(coin.id)))
          .then(() => {
            this.showSuccessMessage('Selected coins deleted successfully');
            this.selectedCoins.set([]);
          })
          .catch((error) => {
            this.showErrorMessage('Failed to delete some coins');
            console.error('Error deleting selected coins:', error);
          });
      }
    });
  }

  syncCoins(): void {
    this.syncCoinsMutation.mutate(undefined, {
      onSuccess: (response) => {
        this.showSuccessMessage(response.message || 'Coins synced successfully');
      },
      onError: (error) => {
        this.showErrorMessage(error.message || 'Failed to sync coins');
      }
    });
  }

  syncCoinDetails(): void {
    this.syncCoinDetailsMutation.mutate(undefined, {
      onSuccess: (response) => {
        this.showSuccessMessage(response.message || 'Coin details synced successfully');
      },
      onError: (error) => {
        this.showErrorMessage(error.message || 'Failed to sync coin details');
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
