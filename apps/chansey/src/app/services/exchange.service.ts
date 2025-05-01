import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { Observable, catchError, throwError } from 'rxjs';

import { Exchange } from '@chansey/api-interfaces';

import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class ExchangeService {
  constructor(
    private authService: AuthService,
    private http: HttpClient
  ) {}

  getSupportedExchanges(): Observable<Exchange[]> {
    const token = this.authService.getToken();
    return this.http
      .get<Exchange[]>('/api/exchange', {
        params: new HttpParams().set('supported', 'true'),
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
      .pipe(
        catchError((error) => {
          console.error('Error fetching supported exchanges:', error);
          return throwError(() => error);
        })
      );
  }
}
