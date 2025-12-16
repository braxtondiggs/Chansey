import {
  CACHE_POLICIES,
  STANDARD_POLICY,
  REALTIME_POLICY,
  FREQUENT_POLICY,
  STABLE_POLICY,
  STATIC_POLICY,
  INFINITE_POLICY,
  getCachePolicy,
  mergeCachePolicy,
  createCachePolicy,
  TIME
} from './cache-policies';

describe('cache-policies', () => {
  it('returns named policy via getCachePolicy', () => {
    expect(getCachePolicy('standard')).toBe(CACHE_POLICIES.standard);
    expect(getCachePolicy('realtime').staleTime).toBe(0);
    expect(getCachePolicy('infinite').staleTime).toBe(Infinity);
  });

  it('merges cache policy overrides', () => {
    const merged = mergeCachePolicy(STANDARD_POLICY, { staleTime: TIME.MINUTES.m2, retry: 0 });
    expect(merged.staleTime).toBe(TIME.MINUTES.m2);
    expect(merged.retry).toBe(0);
    expect(merged.gcTime).toBe(STANDARD_POLICY.gcTime);
  });

  it('creates cache policy with sensible defaults', () => {
    const custom = createCachePolicy({ refetchOnWindowFocus: false });
    expect(custom.staleTime).toBe(TIME.MINUTES.m1);
    expect(custom.gcTime).toBe(TIME.MINUTES.m10);
    expect(custom.refetchOnWindowFocus).toBe(false);
  });

  it('defines expected timing constants', () => {
    expect(TIME.SECONDS.s30).toBe(30_000);
    expect(TIME.MINUTES.m5).toBe(300_000);
    expect(TIME.HOURS.h24).toBe(86_400_000);
  });

  it('exposes policy characteristics for realtime/frequent/stable/static/infinite', () => {
    expect(REALTIME_POLICY.refetchInterval).toBe(TIME.SECONDS.s45);
    expect(REALTIME_POLICY.refetchOnWindowFocus).toBe('always');
    expect(FREQUENT_POLICY.refetchInterval).toBe(TIME.MINUTES.m1);
    expect(STABLE_POLICY.refetchOnWindowFocus).toBe(false);
    expect(STATIC_POLICY.gcTime).toBe(TIME.HOURS.h1);
    expect(INFINITE_POLICY.staleTime).toBe(Infinity);
  });

  it('applies bounded retry delays', () => {
    expect((REALTIME_POLICY.retryDelay as (a: number, e: Error) => number)(5, new Error())).toBe(2000);
    expect((FREQUENT_POLICY.retryDelay as (a: number, e: Error) => number)(5, new Error())).toBe(5000);
  });
});
