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
import { InputTextModule } from 'primeng/inputtext';
import { Table, TableModule } from 'primeng/table';
import { ToastModule } from 'primeng/toast';
import { Observable } from 'rxjs';

import { Category, CategoriesService, CreateCategoryDto, UpdateCategoryDto } from './categories.service';

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
export class CategoriesComponent implements OnInit {
  @ViewChild('dt') dt!: Table;
  categories: Category[] = [];
  category!: Category | null;
  selectedCategories!: Category[] | null;
  categoryDialog: boolean = false;
  deleteDialog: boolean = false;
  categoryForm: FormGroup;
  isLoading: boolean = false;
  isSyncing: boolean = false;
  submitted: boolean = false;
  isNew: boolean = true;

  constructor(
    private categoriesService: CategoriesService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService,
    private fb: FormBuilder
  ) {
    this.categoryForm = this.fb.group({
      name: ['', [Validators.required]]
    });
  }

  ngOnInit(): void {
    this.loadCategories();
  }

  loadCategories(): void {
    this.isLoading = true;
    this.categoriesService.getCategories().subscribe({
      next: (data) => {
        this.categories = data;
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to load categories'
        });
        console.error('Error loading categories:', error);
        this.isLoading = false;
      }
    });
  }

  openNewCategoryDialog(): void {
    this.category = null;
    this.isNew = true;
    this.submitted = false;
    this.categoryForm.reset();
    this.categoryDialog = true;
  }

  openEditCategoryDialog(category: Category): void {
    this.category = { ...category };
    this.isNew = false;
    this.submitted = false;
    this.categoryForm.patchValue({
      name: category.name,
      slug: category.slug
    });
    this.categoryDialog = true;
  }

  confirmDeleteCategory(category: Category): void {
    this.category = category;
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the category "${category.name}"?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.deleteCategory();
      }
    });
  }

  hideDialog(): void {
    this.categoryDialog = false;
    this.submitted = false;
    this.categoryForm.reset();
  }

  saveCategory(): void {
    this.submitted = true;

    if (this.categoryForm.invalid) {
      return;
    }

    const categoryData = this.categoryForm.value;

    if (this.isNew) {
      this.createCategory(categoryData);
    } else if (this.category) {
      this.updateCategory(this.category.id, categoryData);
    }
  }

  createCategory(categoryData: CreateCategoryDto): void {
    this.isLoading = true;
    this.categoriesService.createCategory(categoryData).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Category created successfully'
        });
        this.loadCategories();
        this.hideDialog();
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to create category'
        });
        console.error('Error creating category:', error);
        this.isLoading = false;
      }
    });
  }

  updateCategory(id: string, categoryData: UpdateCategoryDto): void {
    this.isLoading = true;
    this.categoriesService.updateCategory(id, categoryData).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Category updated successfully'
        });
        this.loadCategories();
        this.hideDialog();
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to update category'
        });
        console.error('Error updating category:', error);
        this.isLoading = false;
      }
    });
  }

  deleteCategory(): void {
    if (!this.category) return;

    this.isLoading = true;
    this.categoriesService.deleteCategory(this.category.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Category deleted successfully'
        });
        this.loadCategories();
        this.category = null;
        this.isLoading = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to delete category'
        });
        console.error('Error deleting category:', error);
        this.isLoading = false;
      }
    });
  }

  applyGlobalFilter(event: Event): void {
    const filterValue = (event.target as HTMLInputElement).value;
    this.dt.filterGlobal(filterValue, 'contains');
  }

  deleteSelectedCategories(): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the selected categories?`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.isLoading = true;
        const deletionPromises: Observable<void>[] = [];

        this.selectedCategories?.forEach((category) => {
          deletionPromises.push(this.categoriesService.deleteCategory(category.id));
        });

        // Use forkJoin to wait for all deletion operations to complete
        import('rxjs').then(({ forkJoin }) => {
          forkJoin(deletionPromises).subscribe({
            next: () => {
              this.messageService.add({
                severity: 'success',
                summary: 'Success',
                detail: 'Categories deleted successfully'
              });
              this.selectedCategories = null;
              this.loadCategories();
              this.isLoading = false;
            },
            error: (error) => {
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: 'Failed to delete one or more categories'
              });
              console.error('Error deleting categories:', error);
              this.loadCategories();
              this.isLoading = false;
            }
          });
        });
      }
    });
  }

  syncCategories(): void {
    this.isSyncing = true;
    this.categoriesService.syncCategories().subscribe({
      next: (response) => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: response.message || 'Categories synced successfully'
        });
        this.loadCategories();
        this.isSyncing = false;
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to sync categories'
        });
        console.error('Error syncing categories:', error);
        this.isSyncing = false;
      }
    });
  }
}
