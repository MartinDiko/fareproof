import { describe, expect, it } from 'vitest';
import { migratePolicyStatus, policyStatusSchema } from './state';

describe('policy status migration', () => {
  it('reclassifies the persisted Matrix outage without hiding extension errors', () => {
    const matrixOutage = policyStatusSchema.parse({
      policyId: 'fare-1',
      state: 'error',
      message: 'ITA Matrix did not return fare data after two attempts. The Matrix console ERROR Object is site-generated; FareProof will retry at the next scheduled interval.',
    });
    const extensionError = policyStatusSchema.parse({ policyId: 'fare-2', state: 'error', message: 'Could not select a Matrix date.' });

    expect(migratePolicyStatus(matrixOutage).state).toBe('blocked');
    expect(migratePolicyStatus(extensionError).state).toBe('error');
  });
});