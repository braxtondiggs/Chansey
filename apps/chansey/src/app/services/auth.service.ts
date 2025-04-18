import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';

import { BehaviorSubject, Observable, catchError, of, tap } from 'rxjs';

import { IUser, ILogoutResponse } from '@chansey/api-interfaces';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private userSubject = new BehaviorSubject<IUser | null>(null);
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

  // Method to update user state directly from other services
  updateUserState(user: IUser | null): void {
    this.userSubject.next(user);
  }

  logout(): Observable<null> | void {
    const token = this.getToken();

    if (!token) return of(null);

    this.http
      .post<ILogoutResponse>('api/auth/logout', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
      .pipe(
        catchError((error) => {
          console.error('Logout error:', error);
          return of({ success: false });
        })
      )
      .subscribe({
        complete: () => {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          this.userSubject.next(null);
          this.router.navigate(['/login']);
        }
      });
  }

  isAuthenticated(): Observable<boolean> {
    const token = localStorage.getItem('token');

    if (!token) {
      return of(false);
    }

    // Check if token is expired
    try {
      const tokenPayload = JSON.parse(atob(token.split('.')[1]));
      const isTokenValid = tokenPayload.exp * 1000 > Date.now();

      if (!isTokenValid) {
        this.logout();
        return of(false);
      }

      return of(true);
    } catch (error) {
      this.logout();
      return of(false);
    }
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  getUserInfo(): Observable<IUser | null> {
    const token = this.getToken();

    if (!token) return of(null);

    return this.http
      .get<IUser>('/api/user', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
      .pipe(
        tap((user) => {
          // Store user data
          localStorage.setItem('user', JSON.stringify(user));
          this.userSubject.next(user);
        }),
        catchError((error) => {
          console.error('Error fetching user info:', error);
          this.logout();
          return of(null);
        })
      );
  }
}
