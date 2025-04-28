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
import { ImageModule } from 'primeng/image';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule, Table } from 'primeng/table';
import { ToastModule } from 'primeng/toast';

import { Coin, CoinsService, CreateCoinDto, UpdateCoinDto } from './coins.service';

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
    TableModule,
    ToastModule
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './coins.component.html'
})
export class CoinsComponent implements OnInit {
  @ViewChild('dt') dt: Table | undefined;

  coins: Coin[] = [];
  coin: Coin | null = null;
  coinDialog: boolean = false;
  coinForm: FormGroup;
  isLoading: boolean = false;
  submitted: boolean = false;
  isNew: boolean = true;
  selectedCoins: Coin[] = [];

  constructor(
    private coinsService: CoinsService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService,
    private fb: FormBuilder
  ) {
    this.coinForm = this.fb.group({
      name: ['', [Validators.required]],
      symbol: ['', [Validators.required]]
    });
  }

  ngOnInit(): void {
    this.loadCoins();
  }

  loadCoins(): void {
    this.isLoading = true;
    this.coinsService.getCoins().subscribe({
      next: (data) => {
        this.coins = data;
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to load coins'
        });
        console.error('Error loading coins:', error);
        this.isLoading = false;
      }
    });
  }

  openNewCoinDialog(): void {
    this.coin = null;
    this.isNew = true;
    this.submitted = false;
    this.coinForm.reset();
    this.coinDialog = true;
  }

  openEditCoinDialog(coin: Coin): void {
    this.coin = { ...coin };
    this.isNew = false;
    this.submitted = false;
    this.coinForm.patchValue({
      name: coin.name,
      symbol: coin.symbol
    });
    this.coinDialog = true;
  }

  confirmDeleteCoin(coin: Coin): void {
    this.coin = coin;
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the coin "${coin.name}"?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.deleteCoin();
      }
    });
  }

  hideDialog(): void {
    this.coinDialog = false;
    this.submitted = false;
    this.coinForm.reset();
  }

  saveCoin(): void {
    this.submitted = true;

    if (this.coinForm.invalid) {
      return;
    }

    const coinData = this.coinForm.value;

    if (this.isNew) {
      this.createCoin(coinData);
    } else if (this.coin) {
      this.updateCoin(this.coin.id, coinData);
    }
  }

  createCoin(coinData: CreateCoinDto): void {
    this.isLoading = true;
    this.coinsService.createCoin(coinData).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Coin created successfully'
        });
        this.loadCoins();
        this.hideDialog();
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to create coin'
        });
        console.error('Error creating coin:', error);
        this.isLoading = false;
      }
    });
  }

  updateCoin(id: string, coinData: UpdateCoinDto): void {
    this.isLoading = true;
    this.coinsService.updateCoin(id, coinData).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Coin updated successfully'
        });
        this.loadCoins();
        this.hideDialog();
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to update coin'
        });
        console.error('Error updating coin:', error);
        this.isLoading = false;
      }
    });
  }

  deleteCoin(): void {
    if (!this.coin) return;

    this.isLoading = true;
    this.coinsService.deleteCoin(this.coin.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Coin deleted successfully'
        });
        this.loadCoins();
        this.coin = null;
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to delete coin'
        });
        console.error('Error deleting coin:', error);
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

  deleteSelectedCoins(): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the selected coins?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.isLoading = true;
        const deleteObservables = this.selectedCoins.map((coin) => this.coinsService.deleteCoin(coin.id));

        // Using Promise.all to handle multiple observables
        Promise.all(deleteObservables.map((obs) => obs.toPromise()))
          .then(() => {
            this.messageService.add({
              severity: 'success',
              summary: 'Success',
              detail: 'Coins deleted successfully'
            });
            this.selectedCoins = [];
            this.loadCoins();
            this.isLoading = false;
          })
          .catch((error) => {
            this.messageService.add({
              severity: 'error',
              summary: 'Error',
              detail: 'Failed to delete some coins'
            });
            console.error('Error deleting coins:', error);
            this.isLoading = false;
          });
      }
    });
  }
}
