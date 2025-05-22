import { CommonModule } from '@angular/common';
import { Component, ViewChild, computed, effect, inject, signal } from '@angular/core';
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
import { InputTextModule } from 'primeng/inputtext';
import { Table, TableModule } from 'primeng/table';
import { ToastModule } from 'primeng/toast';

import { Category, CategoriesService } from './categories.service';

@Component({
  selector: 'app-categories',
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
    InputTextModule,
    ReactiveFormsModule,
    TableModule,
    ToastModule
  ],
  providers: [MessageService, ConfirmationService],
  templateUrl: './categories.component.html'
})
export class CategoriesComponent {
  @ViewChild('dt') dt!: Table;

  // State signals
  categories = signal<Category[]>([]);
  categoryDialog = signal<boolean>(false);
  submitted = signal<boolean>(false);
  isNew = signal<boolean>(true);
  selectedCategories = signal<Category[]>([]);

  // Dependencies
  private categoriesService = inject(CategoriesService);
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private fb = inject(FormBuilder);

  // Form
  categoryForm: FormGroup = this.fb.group({
    name: ['', [Validators.required]]
  });

  // TanStack Query hooks
  categoriesQuery = this.categoriesService.useCategories();
  createCategoryMutation = this.categoriesService.useCreateCategory();
  updateCategoryMutation = this.categoriesService.useUpdateCategory();
  deleteCategoryMutation = this.categoriesService.useDeleteCategory();

  // Computed states
  isLoading = computed(() => this.categoriesQuery.isPending() || this.categoriesQuery.isFetching());
  categoriesData = computed(() => this.categoriesQuery.data() || []);
  categoriesError = computed(() => this.categoriesQuery.error);
  isDeletePending = computed(() => this.deleteCategoryMutation.isPending());
  isCreatePending = computed(() => this.createCategoryMutation.isPending());
  isUpdatePending = computed(() => this.updateCategoryMutation.isPending());
  hasChanges = computed(() => this.categoryForm?.dirty || false);

  constructor() {
    this.initializeQueries();
  }

  private initializeQueries(): void {
    // Set up an effect to update the categories signal when query data changes
    effect(() => {
      const data = this.categoriesData();
      if (data && Array.isArray(data)) {
        this.categories.set(data);
      }
    });
  }

  openNewCategoryDialog(): void {
    this.isNew.set(true);
    this.submitted.set(false);
    this.categoryForm.reset();
    this.categoryDialog.set(true);
  }

  openEditCategoryDialog(category: Category): void {
    this.isNew.set(false);
    this.submitted.set(false);
    this.categoryForm.patchValue({
      name: category.name
    });

    this.categoryDialog.set(true);
  }

  confirmDeleteCategory(category: Category): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete ${category.name}?`,
      header: 'Confirm Delete',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary',
      accept: () => {
        this.deleteCategory(category.id);
      }
    });
  }

  hideDialog(): void {
    this.categoryDialog.set(false);
    this.submitted.set(false);
    this.categoryForm.reset();
  }

  saveCategory(): void {
    this.submitted.set(true);

    if (this.categoryForm.invalid) {
      return;
    }

    const categoryData = this.categoryForm.value;

    if (this.isNew()) {
      // Generate slug on create only
      const slug = this.generateSlug(categoryData.name);
      const createData = {
        ...categoryData,
        slug
      };

      this.createCategoryMutation.mutate(createData, {
        onSuccess: () => {
          this.showSuccessMessage('Category created successfully');
          this.hideDialog();
        },
        onError: (error) => {
          this.showErrorMessage(error.message || 'Failed to create category');
        }
      });
    } else {
      // Find the category we're currently editing to get its ID
      const categories = this.categories();
      const matchingCategory = categories.find((c) => c.name === categoryData.name);

      if (!matchingCategory) {
        this.showErrorMessage('Could not find the category to update');
        return;
      }

      // Include the ID in the update data
      const updateData = {
        ...categoryData,
        id: matchingCategory.id
      };

      this.updateCategoryMutation.mutate(updateData, {
        onSuccess: () => {
          this.showSuccessMessage('Category updated successfully');
          this.hideDialog();
        },
        onError: (error) => {
          this.showErrorMessage(error.message || 'Failed to update category');
        }
      });
    }
  }

  deleteCategory(id: string): void {
    console.log('Deleting category with ID:', id);
    this.deleteCategoryMutation.mutate(id, {
      onSuccess: () => {
        this.showSuccessMessage('Category deleted successfully');
      },
      onError: (error) => {
        this.showErrorMessage(error.message || 'Failed to delete category');
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

  deleteSelectedCategories(): void {
    this.confirmationService.confirm({
      message: 'Are you sure you want to delete the selected categories?',
      header: 'Confirm Multiple Delete',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-secondary',
      accept: () => {
        const selected = this.selectedCategories();
        if (!selected.length) return;

        Promise.all(selected.map((category) => this.deleteCategoryMutation.mutateAsync(category.id)))
          .then(() => {
            this.showSuccessMessage('Selected categories deleted successfully');
            this.selectedCategories.set([]);
          })
          .catch((error) => {
            this.showErrorMessage('Failed to delete some categories');
            console.error('Error deleting selected categories:', error);
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
