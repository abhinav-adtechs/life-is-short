/**
 * Apple's association file for this site (/.well-known/apple-app-site-association), so the iPhone, iPad and Mac apps
 * can use its passkeys: Apple checks it lists the app before WebKit lets the app's web view make or use one. The apps
 * carry the other half, a webcredentials entitlement for this host (docs/apple.md → Passkeys in the apps).
 * Both apps share one bundle id, so one entry covers them. Null without a team id: there's no app to link.
 */
export const DEFAULT_BUNDLE_ID = 'io.github.abhinav-adtechs.lifeisshort';

export function appSiteAssociation(env: { APPLE_TEAM_ID?: string; LIS_BUNDLE_ID?: string }) {
  const team = (env.APPLE_TEAM_ID ?? '').trim();
  const bundle = (env.LIS_BUNDLE_ID ?? '').trim() || DEFAULT_BUNDLE_ID;
  if (!/^[A-Z0-9]{10}$/.test(team) || !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(bundle)) return null;
  return { webcredentials: { apps: [`${team}.${bundle}`] } };
}
