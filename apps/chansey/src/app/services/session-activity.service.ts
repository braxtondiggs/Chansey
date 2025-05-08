import { ApplicationRef, ComponentRef, Injectable, OnDestroy, createComponent, inject } from '@angular/core';

import { Observable, Subject, Subscription, fromEvent, interval, merge, timer } from 'rxjs';
import { debounceTime, takeUntil } from 'rxjs/operators';

import { AuthService } from './auth.service';

import { TimeoutWarningComponent } from '../components/timeout-warning.component';

@Injectable({
  providedIn: 'root'
})
export class SessionActivityService implements OnDestroy {
  private readonly DEFAULT_IDLE_TIME = 30 * 60 * 1000; // 30 minutes by default
  private readonly WARNING_BEFORE_TIMEOUT = 60 * 1000; // Show warning 60 seconds before timeout
  private readonly WARNING_COUNTDOWN_INTERVAL = 1000; // Update warning countdown every second
  private readonly authService = inject(AuthService);
  private readonly appRef = inject(ApplicationRef);

  private timeout = this.DEFAULT_IDLE_TIME;
  private idleTimer: Subscription | null = null;
  private warningTimer: Subscription | null = null;
  private countdownTimer: Subscription | null = null;
  private userActivity = new Subject<void>();
  private destroy$ = new Subject<void>();
  private activityWatchers: Subscription[] = [];

  private warningComponentRef: ComponentRef<TimeoutWarningComponent> | null = null;
  private remainingSeconds = 60;

  logoutMutation = this.authService.useLogoutMutation();

  /**
   * Initialize the session activity monitoring
   * @param idleTimeoutMs Timeout in milliseconds before auto logout (default: 30 minutes)
   */
  init(idleTimeoutMs: number = this.DEFAULT_IDLE_TIME): void {
    this.timeout = idleTimeoutMs;
    this.setupActivityWatchers();
    this.resetTimer();
  }

  /**
   * Stop session activity monitoring and clean up resources
   */
  stop(): void {
    this.destroy$.next();
    this.destroy$.complete();

    if (this.idleTimer) {
      this.idleTimer.unsubscribe();
      this.idleTimer = null;
    }

    if (this.warningTimer) {
      this.warningTimer.unsubscribe();
      this.warningTimer = null;
    }

    if (this.countdownTimer) {
      this.countdownTimer.unsubscribe();
      this.countdownTimer = null;
    }

    this.activityWatchers.forEach((sub) => sub.unsubscribe());
    this.activityWatchers = [];

    this.hideWarning();
  }

  ngOnDestroy(): void {
    this.stop();
  }

  /**
   * Set up event listeners for user activity
   */
  private setupActivityWatchers(): void {
    const activity$: Observable<Event> = merge(
      fromEvent(document, 'mousemove'),
      fromEvent(document, 'mousedown'),
      fromEvent(document, 'keypress'),
      fromEvent(document, 'touchstart'),
      fromEvent(document, 'click'),
      fromEvent(document, 'scroll')
    );

    // Use debounceTime to avoid resetting the timer too often
    const sub = activity$.pipe(debounceTime(300), takeUntil(this.destroy$)).subscribe(() => {
      this.userActivity.next();
    });

    this.activityWatchers.push(sub);

    // Subscribe to user activity to reset the timer
    const activitySub = this.userActivity.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.resetTimer();
    });

    this.activityWatchers.push(activitySub);
  }

  /**
   * Reset the idle timer
   */
  private resetTimer(): void {
    // Cancel any existing timers
    if (this.idleTimer) {
      this.idleTimer.unsubscribe();
      this.idleTimer = null;
    }

    if (this.warningTimer) {
      this.warningTimer.unsubscribe();
      this.warningTimer = null;
    }

    if (this.countdownTimer) {
      this.countdownTimer.unsubscribe();
      this.countdownTimer = null;
    }

    // Hide warning dialog if it's showing
    this.hideWarning();

    // Set timer for showing the warning dialog
    const warningTime = this.timeout - this.WARNING_BEFORE_TIMEOUT;

    this.warningTimer = timer(warningTime)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.showWarning();
      });

    // Set timer for auto logout
    this.idleTimer = timer(this.timeout)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        console.log('Session expired due to inactivity');
        this.hideWarning();
        this.logoutMutation.mutate();
      });
  }

  /**
   * Show the timeout warning dialog
   */
  private showWarning(): void {
    if (this.warningComponentRef) {
      return; // Warning is already showing
    }

    // Create the warning component
    const warningComponentRef = createComponent(TimeoutWarningComponent, {
      environmentInjector: this.appRef.injector
    });

    // Add to the DOM
    document.body.appendChild(warningComponentRef.location.nativeElement);

    // Set initial values
    warningComponentRef.instance.visible = true;
    this.remainingSeconds = this.WARNING_BEFORE_TIMEOUT / 1000;
    warningComponentRef.instance.remainingTime = this.remainingSeconds;

    // Set up event handlers
    warningComponentRef.instance.continue.subscribe(() => {
      this.continueSession();
    });

    warningComponentRef.instance.logout.subscribe(() => {
      this.logoutMutation.mutate();
    });

    // Start countdown timer
    this.countdownTimer = interval(this.WARNING_COUNTDOWN_INTERVAL)
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.remainingSeconds--;
        if (warningComponentRef && warningComponentRef.instance) {
          warningComponentRef.instance.remainingTime = this.remainingSeconds;
        }

        if (this.remainingSeconds <= 0) {
          if (this.countdownTimer) {
            this.countdownTimer.unsubscribe();
            this.countdownTimer = null;
          }
        }
      });

    // Store reference
    this.warningComponentRef = warningComponentRef;

    // Manually trigger change detection
    warningComponentRef.changeDetectorRef.detectChanges();
    this.appRef.tick();
  }

  /**
   * Hide the timeout warning dialog
   */
  private hideWarning(): void {
    if (this.warningComponentRef) {
      this.warningComponentRef.instance.visible = false;
      this.warningComponentRef.changeDetectorRef.detectChanges();

      setTimeout(() => {
        if (this.warningComponentRef) {
          document.body.removeChild(this.warningComponentRef.location.nativeElement);
          this.warningComponentRef.destroy();
          this.warningComponentRef = null;
        }
      }, 300);
    }

    if (this.countdownTimer) {
      this.countdownTimer.unsubscribe();
      this.countdownTimer = null;
    }
  }

  /**
   * Continue the user's session
   */
  private continueSession(): void {
    this.hideWarning();
    this.userActivity.next();
  }
}
