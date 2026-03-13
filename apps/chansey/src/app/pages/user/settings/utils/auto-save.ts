import { DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Subject, debounceTime } from 'rxjs';

export type AutoSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutoSaveHandle {
  trigger: () => void;
  markSaved: () => void;
  markError: () => void;
  status: ReturnType<typeof signal<AutoSaveStatus>>;
}

export function createAutoSave(saveFn: () => void, debounceMs = 500): AutoSaveHandle {
  const destroyRef = inject(DestroyRef);
  const status = signal<AutoSaveStatus>('idle');
  const save$ = new Subject<void>();

  let savedTimer: ReturnType<typeof setTimeout> | undefined;
  let errorTimer: ReturnType<typeof setTimeout> | undefined;

  save$.pipe(debounceTime(debounceMs), takeUntilDestroyed(destroyRef)).subscribe(() => {
    status.set('saving');
    saveFn();
  });

  destroyRef.onDestroy(() => {
    clearTimeout(savedTimer);
    clearTimeout(errorTimer);
  });

  return {
    trigger: () => save$.next(),
    markSaved: () => {
      clearTimeout(savedTimer);
      status.set('saved');
      savedTimer = setTimeout(() => status.set('idle'), 2000);
    },
    markError: () => {
      clearTimeout(errorTimer);
      status.set('error');
      errorTimer = setTimeout(() => status.set('idle'), 3000);
    },
    status
  };
}
