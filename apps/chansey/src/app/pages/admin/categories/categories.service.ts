import { Injectable, Signal } from '@angular/core';

import { injectQuery } from '@tanstack/angular-query-experimental';

import { Category, CreateCategoryDto, UpdateCategoryDto } from '@chansey/api-interfaces';
import { authenticatedFetch, queryKeys, STANDARD_POLICY, useAuthMutation, useAuthQuery } from '@chansey/shared';

/**
 * Service for managing categories in admin panel via TanStack Query
 *
 * Uses centralized query keys and standardized caching policies.
 */
@Injectable({
  providedIn: 'root'
})
export class CategoriesService {
  private readonly apiUrl = '/api/category';

  /**
   * Query all categories
   */
  useCategories() {
    return useAuthQuery<Category[]>(queryKeys.categories.lists(), this.apiUrl, {
      cachePolicy: STANDARD_POLICY
    });
  }

  /**
   * Query a single category by ID (dynamic query)
   *
   * @param categoryId - Signal containing the category ID
   */
  useCategory(categoryId: Signal<string | null>) {
    return injectQuery(() => {
      const id = categoryId();
      return {
        queryKey: queryKeys.categories.detail(id || ''),
        queryFn: () => authenticatedFetch<Category>(`${this.apiUrl}/${id}`),
        ...STANDARD_POLICY,
        enabled: !!id
      };
    });
  }

  /**
   * Create a new category
   */
  useCreateCategory() {
    return useAuthMutation<Category, CreateCategoryDto>(this.apiUrl, 'POST', {
      invalidateQueries: [queryKeys.categories.all]
    });
  }

  /**
   * Update an existing category
   */
  useUpdateCategory() {
    return useAuthMutation<Category, UpdateCategoryDto>((variables) => `${this.apiUrl}/${variables.id}`, 'PATCH', {
      invalidateQueries: [queryKeys.categories.all]
    });
  }

  /**
   * Delete a category
   */
  useDeleteCategory() {
    return useAuthMutation<void, string>((id: string) => `${this.apiUrl}/${id}`, 'DELETE', {
      invalidateQueries: [queryKeys.categories.all]
    });
  }
}
