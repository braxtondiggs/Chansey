import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { Observable } from 'rxjs';

import { AuthService } from '@chansey-web/app/services';

export interface Exchange {
  id: string;
  name: string;
  slug: string;
  url: string;
  logo: string;
  supported: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExchangeDto {
  name: string;
  slug: string;
  url: string;
  logo?: string;
  supported?: boolean;
}

export interface UpdateExchangeDto {
  name?: string;
  slug?: string;
  url?: string;
  logo?: string;
  supported?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ExchangesService {
  private apiUrl = '/api/exchange';

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

  getExchanges(): Observable<Exchange[]> {
    return this.http.get<Exchange[]>(this.apiUrl, this.authHeaders);
  }

  getExchange(id: string): Observable<Exchange> {
    return this.http.get<Exchange>(`${this.apiUrl}/${id}`, this.authHeaders);
  }

  createExchange(exchange: CreateExchangeDto): Observable<Exchange> {
    return this.http.post<Exchange>(this.apiUrl, exchange, this.authHeaders);
  }

  updateExchange(id: string, exchange: UpdateExchangeDto): Observable<Exchange> {
    return this.http.patch<Exchange>(`${this.apiUrl}/${id}`, exchange, this.authHeaders);
  }

  deleteExchange(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`, this.authHeaders);
  }

  syncExchanges(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/sync`, {}, this.authHeaders);
  }
}
