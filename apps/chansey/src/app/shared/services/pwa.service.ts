import { Injectable, inject } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';

import { BehaviorSubject, Observable, filter } from 'rxjs';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

@Injectable({
  providedIn: 'root'
})
export class PwaService {
  private readonly swUpdate = inject(SwUpdate, { optional: true });
  private installPromptEvent: BeforeInstallPromptEvent | null = null;
  private _installable$ = new BehaviorSubject<boolean>(false);

  constructor() {
    this.handleAppUpdates();
    this.handleInstallPrompt();
  }

  get installable$(): Observable<boolean> {
    return this._installable$.asObservable();
  }

  private handleAppUpdates(): void {
    if (this.swUpdate?.isEnabled) {
      // Check for service worker updates
      this.swUpdate.versionUpdates
        .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
        .subscribe(() => {
          if (this.swUpdate) {
            this.swUpdate.activateUpdate().then(() => {
              window.location.reload();
            });
          }
        });

      // Check for updates every 6 hours
      setInterval(
        () => {
          if (this.swUpdate) {
            this.swUpdate.checkForUpdate();
          }
        },
        6 * 60 * 60 * 1000
      );
    }
  }

  private handleInstallPrompt(): void {
    window.addEventListener('beforeinstallprompt', (event: Event) => {
      event.preventDefault();
      this.installPromptEvent = event as BeforeInstallPromptEvent;
      this._installable$.next(true);
    });

    window.addEventListener('appinstalled', () => {
      this._installable$.next(false);
      this.installPromptEvent = null;
    });
  }

  promptInstall(): void {
    if (this.installPromptEvent) {
      this.installPromptEvent.prompt();

      this.installPromptEvent.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          console.log('User accepted the install prompt');
        } else {
          console.log('User dismissed the install prompt');
        }
        this.installPromptEvent = null;
      });
    }
  }
}
