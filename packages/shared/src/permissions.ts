// Who can do what. This is the only place that knows about role names.
// Endpoints ask for a permission, never a role, so adding a role means
// adding one entry here (plus the enum value in the Prisma schema).

export const ROLES = ['ADMIN', 'KITCHEN', 'DISPATCH', 'DRIVER'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'staff.manage',
  'settings.manage',
  'catalogue.view',
  'catalogue.manage',
  'companies.view',
  'companies.manage',
  'orders.view',
  'orders.manage',
  'orders.override', // after cut-off edits, reject, delivery overrides, force-complete
  'kitchen.view',
  'kitchen.work',
  'dispatch.view',
  'dispatch.work',
  'deliveries.own', // a driver's own drops for today
  'billing.view',
  'billing.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  KITCHEN: ['kitchen.view', 'kitchen.work', 'orders.view', 'catalogue.view'],
  DISPATCH: ['dispatch.view', 'dispatch.work', 'orders.view', 'companies.view'],
  DRIVER: ['deliveries.own'],
};

export const can = (role: Role, permission: Permission) =>
  ROLE_PERMISSIONS[role].includes(permission);
