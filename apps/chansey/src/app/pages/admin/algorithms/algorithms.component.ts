import { Component, ViewChild, ElementRef, computed, effect, inject, signal, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { InputTextModule } from 'primeng/inputtext';
import { Table, TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';

import {
  Algorithm,
  AlgorithmCategory,
  AlgorithmDrawerSaveEvent,
  AlgorithmStatus,
  AlgorithmStrategy,
  CreateAlgorithmDto,
  UpdateAlgorithmDto
} from '@chansey/api-interfaces';

import { AlgorithmsService } from './algorithms.service';
import { AlgorithmEditDrawerComponent } from './components/algorithm-edit-drawer/algorithm-edit-drawer.component';

@Component({
  selector: 'app-algorithms',
  standalone: true,
  imports: [
    ButtonModule,
    CardModule,
    ConfirmDialogModule,
    IconFieldModule,
    InputIconModule,
    InputTextModule,
    TableModule,
    TagModule,
    ToastModule,
    TooltipModule,
    AlgorithmEditDrawerComponent
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './algorithms.component.html'
})
export class AlgorithmsComponent implements OnInit {
  @ViewChild('dt') dt!: Table;
  @ViewChild('searchInput') searchInput: ElementRef<HTMLInputElement> | undefined;
  @ViewChild('editDrawer') editDrawer!: AlgorithmEditDrawerComponent;

  // State signals
  algorithms = signal<Algorithm[]>([]);
  strategies = signal<AlgorithmStrategy[]>([]);
  selectedAlgorithms = signal<Algorithm[]>([]);
  searchFilter = signal<string>('');
  editingAlgorithm = signal<Algorithm | null>(null);
  drawerVisible = signal<boolean>(false);

  // Dependencies
  private algorithmsService = inject(AlgorithmsService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  // Dropdown options for display
  categoryOptions = [
    { label: 'Technical Analysis', value: AlgorithmCategory.TECHNICAL },
    { label: 'Fundamental Analysis', value: AlgorithmCategory.FUNDAMENTAL },
    { label: 'Sentiment Analysis', value: AlgorithmCategory.SENTIMENT },
    { label: 'Hybrid', value: AlgorithmCategory.HYBRID },
    { label: 'Custom', value: AlgorithmCategory.CUSTOM }
  ];

  // TanStack Query hooks
  algorithmsQuery = this.algorithmsService.useAlgorithms();
  strategiesQuery = this.algorithmsService.useStrategies();
  createAlgorithmMutation = this.algorithmsService.useCreateAlgorithm();
  updateAlgorithmMutation = this.algorithmsService.useUpdateAlgorithm();
  deleteAlgorithmMutation = this.algorithmsService.useDeleteAlgorithm();

  // Computed states
  isLoading = computed(() => this.algorithmsQuery.isPending() || this.algorithmsQuery.isFetching());
  algorithmsData = computed(() => this.algorithmsQuery.data() || []);
  strategiesData = computed(() => this.strategiesQuery.data() || []);
  isDeletePending = computed(() => this.deleteAlgorithmMutation.isPending());
  isSavePending = computed(() => this.createAlgorithmMutation.isPending() || this.updateAlgorithmMutation.isPending());

  constructor() {
    this.initializeQueries();
  }

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      const editId = params['edit'];
      if (editId) {
        this.handleEditQueryParam(editId);
      }
    });
  }

  private handleEditQueryParam(algorithmId: string): void {
    const checkAndOpenEdit = () => {
      const algorithms = this.algorithmsData();
      if (algorithms.length > 0) {
        const algorithm = algorithms.find((a) => a.id === algorithmId);
        if (algorithm) {
          this.openEditAlgorithmDrawer(algorithm);
          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: {},
            replaceUrl: true
          });
        }
      } else {
        setTimeout(checkAndOpenEdit, 100);
      }
    };
    checkAndOpenEdit();
  }

  private initializeQueries(): void {
    effect(() => {
      const data = this.algorithmsData();
      if (data && Array.isArray(data)) {
        this.algorithms.set(data);
      }
    });

    effect(() => {
      const data = this.strategiesData();
      if (data && Array.isArray(data)) {
        this.strategies.set(data);
      }
    });
  }

  openNewAlgorithmDrawer(): void {
    this.editingAlgorithm.set(null);
    this.editDrawer.openForCreate();
  }

  openEditAlgorithmDrawer(algorithm: Algorithm): void {
    this.editingAlgorithm.set(algorithm);
    this.editDrawer.openForEdit(algorithm);
  }

  onDrawerSave(event: AlgorithmDrawerSaveEvent): void {
    if (event.id) {
      // Update existing
      const updateData: UpdateAlgorithmDto = { ...event.data, id: event.id };
      this.updateAlgorithmMutation.mutate(updateData, {
        onSuccess: () => {
          this.showSuccessMessage('Algorithm updated successfully');
          this.editDrawer.hideDrawer();
        },
        onError: (error) => {
          this.showErrorMessage(error.message || 'Failed to update algorithm');
        }
      });
    } else {
      // Create new
      const createData: CreateAlgorithmDto = event.data;
      this.createAlgorithmMutation.mutate(createData, {
        onSuccess: () => {
          this.showSuccessMessage('Algorithm created successfully');
          this.editDrawer.hideDrawer();
        },
        onError: (error) => {
          this.showErrorMessage(error.message || 'Failed to create algorithm');
        }
      });
    }
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

  getStatusSeverity(status: AlgorithmStatus | boolean): 'success' | 'secondary' | 'warn' | 'danger' {
    if (typeof status === 'boolean') {
      return status ? 'success' : 'secondary';
    }
    switch (status) {
      case AlgorithmStatus.ACTIVE:
        return 'success';
      case AlgorithmStatus.MAINTENANCE:
        return 'warn';
      case AlgorithmStatus.ERROR:
        return 'danger';
      case AlgorithmStatus.INACTIVE:
      default:
        return 'secondary';
    }
  }

  getStatusLabel(status: AlgorithmStatus | boolean): string {
    if (typeof status === 'boolean') {
      return status ? 'Active' : 'Inactive';
    }
    switch (status) {
      case AlgorithmStatus.ACTIVE:
        return 'Active';
      case AlgorithmStatus.INACTIVE:
        return 'Inactive';
      case AlgorithmStatus.MAINTENANCE:
        return 'Maintenance';
      case AlgorithmStatus.ERROR:
        return 'Error';
      default:
        return 'Unknown';
    }
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

  viewAlgorithm(algorithm: Algorithm): void {
    this.router.navigate(['/admin/algorithms', algorithm.id]);
  }

  getCategoryLabel(category: AlgorithmCategory): string {
    const option = this.categoryOptions.find((o) => o.value === category);
    return option?.label || category;
  }
}
