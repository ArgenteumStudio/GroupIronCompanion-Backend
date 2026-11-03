export const DEFAULT_PERMISSIONS = Object.freeze({
  banks: true, storage: true, stats: true, locations: true, activity: true,
});

export function permissionsFor(member) {
  return member.memberTokenId ? { ...DEFAULT_PERMISSIONS, ...member.permissions } : { ...DEFAULT_PERMISSIONS };
}

export function validPermissions(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === Object.keys(DEFAULT_PERMISSIONS).length &&
    Object.keys(value).every(key => Object.hasOwn(DEFAULT_PERMISSIONS, key) && typeof value[key] === 'boolean');
}

export const withinPermissions = (requested, granted) =>
  Object.keys(DEFAULT_PERMISSIONS).every(key => !requested[key] || granted[key]);
