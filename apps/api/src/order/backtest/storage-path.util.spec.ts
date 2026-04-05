import { parseStorageLocation, sanitizeObjectPath } from './storage-path.util';

describe('sanitizeObjectPath', () => {
  it('returns normalized path for valid input', () => {
    expect(sanitizeObjectPath('datasets/btc.csv')).toBe('datasets/btc.csv');
    expect(sanitizeObjectPath('datasets//btc.csv')).toBe('datasets/btc.csv');
  });

  it.each([
    ['prefix traversal', '../secrets.csv'],
    ['mid-path traversal', 'datasets/../secrets.csv']
  ])('rejects path traversal (%s)', (_label, input) => {
    expect(() => sanitizeObjectPath(input)).toThrow('path traversal not allowed');
  });

  it('rejects absolute paths', () => {
    expect(() => sanitizeObjectPath('/datasets/btc.csv')).toThrow('absolute paths not allowed');
  });

  it('rejects null bytes', () => {
    expect(() => sanitizeObjectPath('datasets/btc\0.csv')).toThrow('null bytes not allowed');
  });

  it.each([
    ['empty string', ''],
    ['dot-only path', '.']
  ])('rejects empty paths (%s)', (_label, input) => {
    expect(() => sanitizeObjectPath(input)).toThrow('path cannot be empty');
  });
});

describe('parseStorageLocation', () => {
  it('parses s3:// URLs to object path', () => {
    expect(parseStorageLocation('s3://my-bucket/datasets/btc-hourly.csv')).toBe('datasets/btc-hourly.csv');
  });

  it('rejects s3:// URLs without path', () => {
    expect(() => parseStorageLocation('s3://bucket-only')).toThrow('Invalid s3:// URL format');
  });

  it('rejects s3:// URLs with path traversal', () => {
    expect(() => parseStorageLocation('s3://bucket/../etc/passwd')).toThrow('path traversal not allowed');
  });

  it('parses http/https URLs stripping bucket prefix', () => {
    expect(parseStorageLocation('http://minio:9000/my-bucket/datasets/btc.csv')).toBe('datasets/btc.csv');
    expect(parseStorageLocation('https://storage.example.com/bucket/deep/path/file.csv')).toBe('deep/path/file.csv');
  });

  it('rejects http URLs with insufficient path segments', () => {
    expect(() => parseStorageLocation('http://minio:9000/bucket-only')).toThrow('Failed to parse storage URL');
  });

  it('trims whitespace from input', () => {
    expect(parseStorageLocation('  datasets/btc-hourly.csv  ')).toBe('datasets/btc-hourly.csv');
  });

  it('passes through direct paths', () => {
    expect(parseStorageLocation('datasets/btc-hourly.csv')).toBe('datasets/btc-hourly.csv');
  });
});
