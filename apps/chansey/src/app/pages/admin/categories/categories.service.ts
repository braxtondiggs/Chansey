import { Injectable } from '@angular/core';

import { categoryKeys } from '@chansey-web/app/core/query/query.keys';
import { useAuthQuery, useAuthMutation } from '@chansey-web/app/core/query/query.utils';

export interface Category {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCategoryDto {
  name: string;
  slug: string;
}

export interface UpdateCategoryDto {
  id: string;
  name?: string;
  slug?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CategoriesService {
  private apiUrl = '/api/category';

  useCategories() {
    return useAuthQuery<Category[]>(categoryKeys.lists.all, this.apiUrl);
  }

  useCategory() {
    return useAuthQuery<Category, string>(
      (id: string) => categoryKeys.detail(id),
      (id: string) => `${this.apiUrl}/${id}`
    );
  }

  useCreateCategory() {
    return useAuthMutation<Category, CreateCategoryDto>(this.apiUrl, 'POST', {
      invalidateQueries: [categoryKeys.lists.all]
    });
  }

  useUpdateCategory() {
    return useAuthMutation<Category, UpdateCategoryDto>((variables) => `${this.apiUrl}/${variables.id}`, 'PATCH', {
      invalidateQueries: [categoryKeys.lists.all]
    });
  }

  useDeleteCategory() {
    return useAuthMutation<void, string>((id: string) => `${this.apiUrl}/${id}`, 'DELETE', {
      invalidateQueries: [categoryKeys.lists.all]
    });
  }
}
