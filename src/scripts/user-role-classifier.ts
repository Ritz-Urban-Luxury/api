export type UserRoleClassification =
  | 'driver'
  | 'rider'
  | 'ambiguous'
  | 'unchanged';

export type UserRoleEvidence = {
  currentIsDriver?: boolean;
  demoRole?: 'driver' | 'rider';
  hasDriverApp: boolean;
  hasDriverActivity: boolean;
  hasDriverProfile: boolean;
  hasOAuthIdentity: boolean;
  hasRiderApp: boolean;
  hasRiderActivity: boolean;
};

export function classifyUserRole(
  evidence: UserRoleEvidence,
): UserRoleClassification {
  if (evidence.demoRole) return evidence.demoRole;
  if (
    evidence.hasDriverApp ||
    evidence.hasDriverActivity ||
    evidence.hasDriverProfile
  ) {
    return 'driver';
  }
  if (
    evidence.hasRiderApp ||
    evidence.hasRiderActivity ||
    evidence.hasOAuthIdentity
  ) {
    return 'rider';
  }
  if (evidence.currentIsDriver === true) return 'ambiguous';
  return 'unchanged';
}
