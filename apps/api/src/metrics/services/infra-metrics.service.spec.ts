import { InfraMetricsService } from './infra-metrics.service';

const createCounterMock = () => ({ inc: jest.fn() }) as any;
const createGaugeMock = () => ({ set: jest.fn() }) as any;
const createHistogramMock = () => ({ observe: jest.fn(), startTimer: jest.fn() }) as any;

const buildService = () => {
  const mocks = {
    httpRequestDuration: createHistogramMock(),
    httpRequestsTotal: createCounterMock(),
    httpConnectionsActive: createGaugeMock(),
    queueJobsWaiting: createGaugeMock(),
    queueJobsActive: createGaugeMock(),
    queueJobsCompletedTotal: createCounterMock(),
    queueJobsFailedTotal: createCounterMock(),
    priceUpdatesTotal: createCounterMock(),
    priceUpdateLag: createGaugeMock(),
    diversityPruningFallbackTotal: createCounterMock()
  };

  const service = new InfraMetricsService(
    mocks.httpRequestDuration,
    mocks.httpRequestsTotal,
    mocks.httpConnectionsActive,
    mocks.queueJobsWaiting,
    mocks.queueJobsActive,
    mocks.queueJobsCompletedTotal,
    mocks.queueJobsFailedTotal,
    mocks.priceUpdatesTotal,
    mocks.priceUpdateLag,
    mocks.diversityPruningFallbackTotal
  );

  return { service, mocks };
};

describe('InfraMetricsService', () => {
  it('converts duration from ms to seconds and stringifies status code', () => {
    const { service, mocks } = buildService();

    service.recordHttpRequest('POST', '/api/orders', 201, 1500);

    expect(mocks.httpRequestDuration.observe).toHaveBeenCalledWith(
      { method: 'POST', route: '/api/orders', status_code: '201' },
      1.5
    );
    expect(mocks.httpRequestsTotal.inc).toHaveBeenCalledWith({
      method: 'POST',
      route: '/api/orders',
      status_code: '201'
    });
  });

  it('sets active HTTP connections gauge', () => {
    const { service, mocks } = buildService();

    service.setActiveConnections(5);

    expect(mocks.httpConnectionsActive.set).toHaveBeenCalledWith(5);
  });

  it('delegates queue metrics with correct labels', () => {
    const { service, mocks } = buildService();

    service.setQueueJobsWaiting('orders', 7);
    expect(mocks.queueJobsWaiting.set).toHaveBeenCalledWith({ queue: 'orders' }, 7);

    service.setQueueJobsActive('orders', 3);
    expect(mocks.queueJobsActive.set).toHaveBeenCalledWith({ queue: 'orders' }, 3);

    service.recordQueueJobCompleted('orders');
    expect(mocks.queueJobsCompletedTotal.inc).toHaveBeenCalledWith({ queue: 'orders' });

    service.recordQueueJobFailed('orders', 'timeout');
    expect(mocks.queueJobsFailedTotal.inc).toHaveBeenCalledWith({ queue: 'orders', error_type: 'timeout' });
  });

  it('defaults errorType to unknown when not provided', () => {
    const { service, mocks } = buildService();

    service.recordQueueJobFailed('orders');

    expect(mocks.queueJobsFailedTotal.inc).toHaveBeenCalledWith({ queue: 'orders', error_type: 'unknown' });
  });

  it('defaults price update count to 1 when not provided', () => {
    const { service, mocks } = buildService();

    service.recordPriceUpdate('coingecko');

    expect(mocks.priceUpdatesTotal.inc).toHaveBeenCalledWith({ source: 'coingecko' }, 1);
  });

  it('delegates price metrics with correct labels', () => {
    const { service, mocks } = buildService();

    service.recordPriceUpdate('coingecko', 2);
    expect(mocks.priceUpdatesTotal.inc).toHaveBeenCalledWith({ source: 'coingecko' }, 2);

    service.setPriceUpdateLag('coingecko', 5);
    expect(mocks.priceUpdateLag.set).toHaveBeenCalledWith({ source: 'coingecko' }, 5);
  });

  it('records diversity pruning fallback with the reason label', () => {
    const { service, mocks } = buildService();

    service.recordDiversityPruningFallback('no_ohlc');
    expect(mocks.diversityPruningFallbackTotal.inc).toHaveBeenCalledWith({ reason: 'no_ohlc' });

    service.recordDiversityPruningFallback('backfill_after_veto');
    expect(mocks.diversityPruningFallbackTotal.inc).toHaveBeenCalledWith({ reason: 'backfill_after_veto' });
  });
});
