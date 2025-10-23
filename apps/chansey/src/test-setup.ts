import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

setupZoneTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true
});

// Suppress console.error globally in tests
global.console.error = jest.fn();

// Chart.js relies on a canvas 2D context that isn't available in JSDOM by default.
// Provide a lightweight mock so PrimeNG's chart component can initialise without errors.
// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};
const canvasContextStub = {
  canvas: document.createElement('canvas'),
  clearRect: noop,
  fillRect: noop,
  getImageData: () => ({ data: [] }),
  putImageData: noop,
  createImageData: () => [],
  setTransform: noop,
  drawImage: noop,
  save: noop,
  fillText: noop,
  restore: noop,
  beginPath: noop,
  moveTo: noop,
  lineTo: noop,
  closePath: noop,
  stroke: noop,
  translate: noop,
  scale: noop,
  rotate: noop,
  arc: noop,
  fill: noop,
  measureText: () => ({ width: 0 }),
  transform: noop,
  rect: noop,
  clip: noop,
  quadraticCurveTo: noop,
  bezierCurveTo: noop,
  strokeRect: noop,
  setLineDash: noop,
  getLineDash: () => [],
  resetTransform: noop,
  drawFocusIfNeeded: noop,
  createRadialGradient: () => ({
    addColorStop: noop
  }),
  createLinearGradient: () => ({
    addColorStop: noop
  }),
  createPattern: () => null,
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 0,
  strokeStyle: '#000000',
  fillStyle: '#000000',
  shadowBlur: 0,
  shadowColor: '#000000',
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  globalCompositeOperation: 'source-over'
};

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  configurable: true,
  value: (contextId: string) => {
    if (contextId === '2d') {
      return canvasContextStub;
    }
    return null;
  }
});
