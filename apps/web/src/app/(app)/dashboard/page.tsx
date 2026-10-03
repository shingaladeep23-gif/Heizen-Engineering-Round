'use client';

import type { Role } from '@fernleaf/shared';
import type { ComponentType } from 'react';
import { DriverDeliveries } from '@/components/DriverDeliveries';
import { AdminDashboard } from '@/components/dashboards/AdminDashboard';
import { DispatchDashboard } from '@/components/dashboards/DispatchDashboard';
import { KitchenDashboard } from '@/components/dashboards/KitchenDashboard';
import { useMe } from '@/lib/api';

// Each role's landing page. The one place that maps roles to dashboards:
// a new role is a type error here until it gets one.
const DASHBOARDS: Record<Role, ComponentType> = {
  ADMIN: AdminDashboard,
  KITCHEN: KitchenDashboard,
  DISPATCH: DispatchDashboard,
  DRIVER: DriverDeliveries,
};

export default function DashboardPage() {
  const { data: me } = useMe();
  if (!me) return null;
  const Dashboard = DASHBOARDS[me.role];
  return <Dashboard />;
}
