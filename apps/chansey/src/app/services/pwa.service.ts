import { Injectable } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';

import { BehaviorSubject, Observable, filter } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class PwaService {
  private installPromptEvent: any;
  private _installable$ = new BehaviorSubject<boolean>(false);

  constructor(private swUpdate: SwUpdate) {
    this.handleAppUpdates();
    this.handleInstallPrompt();
  }

  get installable$(): Observable<boolean> {
    return this._installable$.asObservable();
  }

  private handleAppUpdates(): void {
    if (this.swUpdate.isEnabled) {
      // Check for service worker updates
      this.swUpdate.versionUpdates
        .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
        .subscribe(() => {
          if (confirm('A new version of the application is available. Load it now?')) {
            window.location.reload();
          }
        });

      // Check for updates every 6 hours
      setInterval(
        () => {
          this.swUpdate.checkForUpdate();
        },
        6 * 60 * 60 * 1000
      );
    }
  }

  private handleInstallPrompt(): void {
    window.addEventListener('beforeinstallprompt', (event: any) => {
      event.preventDefault();
      this.installPromptEvent = event;
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

      this.installPromptEvent.userChoice.then((choiceResult: { outcome: string }) => {
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
