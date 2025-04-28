import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { Observable } from 'rxjs';

import { AuthService } from '@chansey-web/app/services';

export interface Risk {
  id: string;
  name: string;
  description: string;
  level: number;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRiskDto {
  name: string;
  description: string;
  level: number;
  color: string;
}

export interface UpdateRiskDto {
  name?: string;
  description?: string;
  level?: number;
  color?: string;
}

@Injectable({
  providedIn: 'root'
})
export class RisksService {
  private apiUrl = '/api/risk';

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

  getRisks(): Observable<Risk[]> {
    return this.http.get<Risk[]>(this.apiUrl, this.authHeaders);
  }

  getRisk(id: string): Observable<Risk> {
    return this.http.get<Risk>(`${this.apiUrl}/${id}`, this.authHeaders);
  }

  createRisk(risk: CreateRiskDto): Observable<Risk> {
    return this.http.post<Risk>(this.apiUrl, risk, this.authHeaders);
  }

  updateRisk(id: string, risk: UpdateRiskDto): Observable<Risk> {
    return this.http.patch<Risk>(`${this.apiUrl}/${id}`, risk, this.authHeaders);
  }

  deleteRisk(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`, this.authHeaders);
  }
}
