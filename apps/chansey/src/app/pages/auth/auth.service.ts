import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, catchError, of, tap } from 'rxjs';

interface User {
    id: string;
    email: string;
    name?: string;
    [key: string]: string | number | boolean | null | undefined; // More specific type than 'any'
}

@Injectable({
    providedIn: 'root',
})
export class AuthService {
    private userSubject = new BehaviorSubject<User | null>(null);
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

    logout(): void {
        // Clear stored data and navigate to login
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        this.userSubject.next(null);
        this.router.navigate(['/login']);
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

    getUserInfo(): Observable<User | null> {
        const token = this.getToken();

        if (!token) return of(null);

        return this.http
            .get<User>('/api/user', {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
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
