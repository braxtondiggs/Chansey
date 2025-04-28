import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { Observable } from 'rxjs';

import { AuthService } from '@chansey-web/app/services';

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
  name?: string;
  slug?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CategoriesService {
  private apiUrl = '/api/category';

  constructor(
    private http: HttpClient,
    private authService: AuthService
  ) {}

  private get authHeaders() {
    const token = this.authService.getToken();
    return {
      headers: {
        Authorization: `Bearer ${token}`
      }
    };
  }

  getCategories(): Observable<Category[]> {
    return this.http.get<Category[]>(this.apiUrl, this.authHeaders);
  }

  getCategory(id: string): Observable<Category> {
    return this.http.get<Category>(`${this.apiUrl}/${id}`, this.authHeaders);
  }

  createCategory(category: CreateCategoryDto): Observable<Category> {
    return this.http.post<Category>(this.apiUrl, category, this.authHeaders);
  }

  updateCategory(id: string, category: UpdateCategoryDto): Observable<Category> {
    return this.http.patch<Category>(`${this.apiUrl}/${id}`, category, this.authHeaders);
  }

  deleteCategory(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`, this.authHeaders);
  }
}
