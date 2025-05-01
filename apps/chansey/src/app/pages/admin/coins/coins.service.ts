import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { Observable } from 'rxjs';

import { AuthService } from '@chansey-web/app/services';

export interface Coin {
  id: string;
  name: string;
  symbol: string;
  slug: string;
  logo: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCoinDto {
  name: string;
  symbol: string;
  slug: string;
  logo?: string;
}

export interface UpdateCoinDto {
  name?: string;
  symbol?: string;
  slug?: string;
  logo?: string;
}

@Injectable({
  providedIn: 'root'
})
export class CoinsService {
  private apiUrl = '/api/coin';

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

  getCoins(): Observable<Coin[]> {
    return this.http.get<Coin[]>(this.apiUrl, this.authHeaders);
  }

  getCoin(id: string): Observable<Coin> {
    return this.http.get<Coin>(`${this.apiUrl}/${id}`, this.authHeaders);
  }

  createCoin(coin: CreateCoinDto): Observable<Coin> {
    return this.http.post<Coin>(this.apiUrl, coin, this.authHeaders);
  }

  updateCoin(id: string, coin: UpdateCoinDto): Observable<Coin> {
    return this.http.patch<Coin>(`${this.apiUrl}/${id}`, coin, this.authHeaders);
  }

  deleteCoin(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`, this.authHeaders);
  }

  syncCoins(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/sync`, {}, this.authHeaders);
  }

  syncCoinDetails(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/sync-detail`, {}, this.authHeaders);
  }
}
