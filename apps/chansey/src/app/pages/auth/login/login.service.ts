import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';

import { BehaviorSubject, Observable, tap } from 'rxjs';

import { ILoginResponse } from '@chansey/api-interfaces';

@Injectable({
  providedIn: 'root'
})
export class LoginService {
  private userSubject = new BehaviorSubject<any>(null);
  user$ = this.userSubject.asObservable();

  constructor(
    private http: HttpClient,
    private router: Router
  ) {
    // Check if user is already logged in
    const savedUser = localStorage.getItem('user');
    if (savedUser) {
      this.userSubject.next(JSON.parse(savedUser));
    }
  }

  login(email: string, password: string, remember = false): Observable<ILoginResponse> {
    return this.http
      .post<ILoginResponse>('/api/auth/login', {
        email,
        password,
        remember
      })
      .pipe(
        tap((response) => {
          localStorage.setItem('user', JSON.stringify(response.user));
          localStorage.setItem('token', response.access_token);
          this.userSubject.next(response.user);
        })
      );
  }
}
