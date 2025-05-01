import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { Observable, catchError, throwError, tap, finalize, Subject, debounceTime, switchMap, of } from 'rxjs';

import { IUser } from '@chansey/api-interfaces';

import { AuthService } from '@chansey-web/app/services';

export interface IUserProfileUpdate {
  given_name?: string;
  family_name?: string;
  middle_name?: string;
  nickname?: string;
  preferred_username?: string;
  picture?: string;
  gender?: string;
  birthdate?: string;
  phone_number?: string;
  risk?: string;
}

export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
  confirm_new_password: string;
}

export interface Risk {
  id: string;
  name: string;
  level: number;
}

@Injectable({
  providedIn: 'root'
})
export class ProfileService {
  // Subject to control profile updates with debounce
  private profileUpdateRequests = new Subject<void>();
  private isUpdatingProfile = false;

  constructor(
    private authService: AuthService,
    private http: HttpClient
  ) {
    // Set up debounced profile update handler
    this.profileUpdateRequests
      .pipe(
        debounceTime(300), // Wait 300ms before processing updates
        switchMap(() => {
          if (this.isUpdatingProfile) {
            return of(null);
          }
          this.isUpdatingProfile = true;
          return this.authService.getUserInfo().pipe(
            tap((user) => {
              if (user) {
                this.authService.updateUserState(user);
              }
              this.isUpdatingProfile = false;
            }),
            catchError((error) => {
              console.error('Error refreshing user profile:', error);
              this.isUpdatingProfile = false;
              return of(null);
            })
          );
        })
      )
      .subscribe();
  }

  updateProfile(userData: IUserProfileUpdate): Observable<IUser> {
    const token = this.authService.getToken();

    return this.http
      .patch<IUser>('/api/user', userData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      .pipe(
        tap((updatedUser) => {
          this.authService.updateUserState(updatedUser);
        }),
        catchError((error) => {
          console.error('Error updating profile:', error);
          return throwError(() => error);
        })
      );
  }

  changePassword(passwordData: ChangePasswordRequest): Observable<any> {
    const token = this.authService.getToken();

    return this.http
      .post<any>('/api/auth/change-password', passwordData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      .pipe(
        catchError((error) => {
          console.error('Error changing password:', error);
          return throwError(() => error);
        })
      );
  }

  getRisks(): Observable<Risk[]> {
    const token = this.authService.getToken();

    return this.http
      .get<Risk[]>('/api/risk', {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
      .pipe(
        catchError((error) => {
          console.error('Error fetching risks:', error);
          return throwError(() => error);
        })
      );
  }

  saveExchangeKeys(exchangeKeyData: any): Observable<any> {
    const token = this.authService.getToken();

    return this.http
      .post<any>('/api/exchange-keys', exchangeKeyData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })
      .pipe(
        catchError((error) => {
          console.error('Error saving exchange keys:', error);
          return throwError(() => error);
        }),
        finalize(() => {
          // Request a debounced profile update
          this.profileUpdateRequests.next();
        })
      );
  }

  deleteExchangeKey(exchangeId: string): Observable<void> {
    const token = this.authService.getToken();

    return this.http
      .delete<void>(`/api/exchange-keys/${exchangeId}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
      .pipe(
        catchError((error) => {
          console.error('Error deleting exchange key:', error);
          return throwError(() => error);
        }),
        finalize(() => {
          // Request a debounced profile update
          this.profileUpdateRequests.next();
        })
      );
  }
}
