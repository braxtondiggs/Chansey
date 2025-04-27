import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';

import { BehaviorSubject, Observable, tap } from 'rxjs';

import { ILoginResponse } from '@chansey/api-interfaces';

import { AuthService } from '@chansey-web/app/services';

@Injectable({
  providedIn: 'root'
})
export class LoginService {
  private userSubject = new BehaviorSubject<any>(null);
  user$ = this.userSubject.asObservable();

  constructor(
    private http: HttpClient,
    private authService: AuthService,
    private router: Router
  ) {}

  login(email: string, password: string, remember = false): Observable<ILoginResponse> {
    return this.http
      .post<ILoginResponse>(
        '/api/auth/login',
        {
          email,
          password,
          remember
        },
        { withCredentials: true }
      )
      .pipe(
        tap((response) => {
          if (response.should_show_email_otp_screen) {
            sessionStorage.setItem('otpEmail', email);
            this.router.navigate(['/auth/otp']);
          }

          // Store data in localStorage
          localStorage.setItem('user', JSON.stringify(response.user));
          localStorage.setItem('token', response.access_token);

          // Update local service state
          this.userSubject.next(response.user);

          // Also update the AuthService state to ensure it's available immediately
          this.authService.updateUserState(response.user);
        })
      );
  }
}
