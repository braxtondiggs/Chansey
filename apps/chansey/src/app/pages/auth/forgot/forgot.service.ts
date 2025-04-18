import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { BehaviorSubject, Observable, tap } from 'rxjs';

import { IForgotPasswordResponse } from '@chansey/api-interfaces';

@Injectable({
  providedIn: 'root'
})
export class ForgotService {
  private userSubject = new BehaviorSubject<any>(null);
  user$ = this.userSubject.asObservable();

  constructor(private http: HttpClient) {
    // Check if user is already logged in
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      this.userSubject.next(JSON.parse(savedUser));
    }
  }

  forgot(email: string): Observable<IForgotPasswordResponse> {
    return this.http
      .post<IForgotPasswordResponse>('api/auth/forgot-password', {
        email
      })
      .pipe(
        tap((response) => {
          this.userSubject.next(response);
        })
      );
  }
}
