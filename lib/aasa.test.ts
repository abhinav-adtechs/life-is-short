import { describe, expect, it } from 'vitest';
import { DEFAULT_BUNDLE_ID, appSiteAssociation } from './aasa';

describe('appSiteAssociation', () => {
  it('lists both apps by team and bundle id', () => {
    expect(appSiteAssociation({ APPLE_TEAM_ID: 'ABCDE12345' })).toEqual({ webcredentials: { apps: [`ABCDE12345.${DEFAULT_BUNDLE_ID}`] } });
    expect(appSiteAssociation({ APPLE_TEAM_ID: ' ABCDE12345 ', LIS_BUNDLE_ID: 'com.example.plan' }))
      .toEqual({ webcredentials: { apps: ['ABCDE12345.com.example.plan'] } });
  });

  it('has nothing to link without a real team id or bundle id', () => {
    expect(appSiteAssociation({})).toBeNull();
    expect(appSiteAssociation({ APPLE_TEAM_ID: 'abcde12345' })).toBeNull();
    expect(appSiteAssociation({ APPLE_TEAM_ID: 'ABCDE1234' })).toBeNull();
    expect(appSiteAssociation({ APPLE_TEAM_ID: 'ABCDE12345', LIS_BUNDLE_ID: 'no dots' })).toBeNull();
    expect(appSiteAssociation({ APPLE_TEAM_ID: 'ABCDE12345', LIS_BUNDLE_ID: 'a.b"c' })).toBeNull();
  });
});
