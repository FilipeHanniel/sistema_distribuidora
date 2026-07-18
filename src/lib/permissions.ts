import type { UserRole } from '../types';

export type AppPermission =
  | 'platform.admin'
  | 'tenant.read'
  | 'tenant.operate'
  | 'users.manage'
  | 'products.manage'
  | 'products.quick_create'
  | 'stock.adjust'
  | 'suppliers.manage'
  | 'purchases.manage'
  | 'sales.read'
  | 'sales.create'
  | 'settings.manage'
  | 'payments.configure'
  | 'payments.create'
  | 'payments.reconcile'
  | 'payments.simulate'
  | 'fiscal.manage'
  | 'reports.view'
  | 'ai.reports.view'
  | 'notifications.manage';

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<AppPermission>> = {
  superadmin: new Set<AppPermission>(['platform.admin']),
  gestor: new Set<AppPermission>([
    'tenant.read',
    'tenant.operate',
    'users.manage',
    'products.manage',
    'products.quick_create',
    'stock.adjust',
    'suppliers.manage',
    'purchases.manage',
    'sales.read',
    'sales.create',
    'settings.manage',
    'payments.configure',
    'payments.create',
    'payments.reconcile',
    'payments.simulate',
    'fiscal.manage',
    'reports.view',
    'ai.reports.view',
    'notifications.manage',
  ]),
  operador: new Set<AppPermission>([
    'tenant.read',
    'tenant.operate',
    'products.quick_create',
    'sales.create',
    'payments.create',
  ]),
};

export const hasRolePermission = (role: UserRole | undefined | null, permission: AppPermission) => {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].has(permission);
};

export const defaultPathForRole = (role: UserRole | undefined | null) => {
  if (role === 'superadmin') return '/superadmin';
  if (role === 'gestor') return '/';
  return '/sales';
};
