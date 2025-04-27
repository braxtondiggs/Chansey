import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { BehaviorSubject, Observable, catchError, throwError, tap } from 'rxjs';

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
  private userSubject = new BehaviorSubject<any>(null);
  user$ = this.userSubject.asObservable();

  constructor(
    private authService: AuthService,
    private http: HttpClient
  ) {}

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
          const currentUser = this.userSubject.getValue();
          const mergedUser = { ...currentUser, ...updatedUser };

          localStorage.setItem('user', JSON.stringify(mergedUser));
          this.userSubject.next(mergedUser);
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
}
