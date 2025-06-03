import { getTestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';

// First, initialize the Angular testing environment.
getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

// Patch Object.defineProperty to make it configurable for Vitest compatibility
const originalDefineProperty = Object.defineProperty;
Object.defineProperty = function <T>(obj: T, prop: PropertyKey, descriptor: PropertyDescriptor & ThisType<any>): T {
  if (descriptor && descriptor.configurable === false) {
    descriptor.configurable = true;
  }
  return originalDefineProperty.call(this, obj, prop, descriptor) as T;
};
