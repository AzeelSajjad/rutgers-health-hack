import { describe, expect, it } from 'vitest';
import { readStorageConfig } from '../src/config.js';

describe('deployed storage configuration', () => {
  it('uses the exact environment names emitted by deployment', () => {
    expect(readStorageConfig({ SESSION_TABLE_NAME: 'actual-table', TRANSCRIPT_BUCKET_NAME: 'actual-bucket' })).toEqual({ sessionsTable: 'actual-table', transcriptBucket: 'actual-bucket' });
  });
  it('fails before starting real AWS dependencies if storage is not configured', () => {
    expect(() => readStorageConfig({})).toThrow(/SESSION_TABLE_NAME/);
    expect(() => readStorageConfig({ SESSION_TABLE_NAME: 'only-table' })).toThrow(/TRANSCRIPT_BUCKET_NAME/);
    expect(() => readStorageConfig({ SESSIONS_TABLE: 'old-table', SESSION_TABLE_NAME: 'new-table', TRANSCRIPT_BUCKET_NAME: 'bucket' })).toThrow(/conflict/i);
  });
  it('permits explicit fake AWS development without a deployed stack', () => {
    expect(readStorageConfig({ FAKE_AWS: '1' })).toEqual({ sessionsTable: '', transcriptBucket: '' });
  });
  it('supports the old table alias with an explicit deprecation warning', () => {
    const warnings: string[] = [];
    expect(readStorageConfig({ SESSIONS_TABLE: 'old-table', TRANSCRIPT_BUCKET_NAME: 'bucket' }, message => warnings.push(message))).toEqual({ sessionsTable: 'old-table', transcriptBucket: 'bucket' });
    expect(warnings.join()).toMatch(/SESSION_TABLE_NAME/);
  });
});
