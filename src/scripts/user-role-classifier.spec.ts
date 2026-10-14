import { classifyUserRole } from './user-role-classifier';

describe('classifyUserRole', () => {
  it('uses the canonical demo role before activity signals', () => {
    expect(
      classifyUserRole({
        currentIsDriver: true,
        demoRole: 'rider',
        hasDriverApp: true,
        hasDriverActivity: true,
        hasDriverProfile: true,
        hasOAuthIdentity: false,
        hasRiderApp: false,
        hasRiderActivity: true,
      }),
    ).toBe('rider');
  });

  it('keeps accounts with driver evidence as drivers', () => {
    expect(
      classifyUserRole({
        hasDriverApp: false,
        hasDriverActivity: false,
        hasDriverProfile: true,
        hasOAuthIdentity: false,
        hasRiderApp: false,
        hasRiderActivity: true,
      }),
    ).toBe('driver');
  });

  it('demotes rider-only activity and leaves no-evidence drivers ambiguous', () => {
    expect(
      classifyUserRole({
        currentIsDriver: true,
        hasDriverApp: false,
        hasDriverActivity: false,
        hasDriverProfile: false,
        hasOAuthIdentity: false,
        hasRiderApp: true,
        hasRiderActivity: true,
      }),
    ).toBe('rider');
    expect(
      classifyUserRole({
        currentIsDriver: true,
        hasDriverApp: false,
        hasDriverActivity: false,
        hasDriverProfile: false,
        hasOAuthIdentity: false,
        hasRiderApp: false,
        hasRiderActivity: false,
      }),
    ).toBe('ambiguous');
  });

  it('classifies OAuth-only accounts as riders', () => {
    expect(
      classifyUserRole({
        currentIsDriver: true,
        hasDriverApp: false,
        hasDriverActivity: false,
        hasDriverProfile: false,
        hasOAuthIdentity: true,
        hasRiderApp: false,
        hasRiderActivity: false,
      }),
    ).toBe('rider');
  });
});
