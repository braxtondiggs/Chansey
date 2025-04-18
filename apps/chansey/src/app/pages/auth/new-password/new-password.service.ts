import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { BehaviorSubject, Observable, tap } from 'rxjs';

import { IResetPasswordResponse } from '@chansey/api-interfaces';

@Injectable({
  providedIn: 'root'
})
export class NewPasswordService {
  private userSubject = new BehaviorSubject<any>(null);
  user$ = this.userSubject.asObservable();

  constructor(private http: HttpClient) {}

  submit(token: string, password: string, confirm_password: string): Observable<IResetPasswordResponse> {
    return this.http
      .post<IResetPasswordResponse>('api/auth/reset-password', {
        token,
        password,
        confirm_password
      })
      .pipe(
        tap((response) => {
          this.userSubject.next(response);
        })
      );
  }
}
