'use client';

import type { Role } from '@fernleaf/shared';
import { Title } from '@mantine/core';
import type { ComponentType } from 'react';
import { DriverDeliveries } from '@/components/DriverDeliveries';
import { useMe } from '@/lib/api';

const heading = (text: string) =>
  function Heading() {
    return <Title order={2}>{text}</Title>;
  };

// Each role's landing page. The one place that maps roles to dashboards:
// a new role is a type error here until it gets one.
const DASHBOARDS: Record<Role, ComponentType> = {
  ADMIN: heading('Admin dashboard'),
  KITCHEN: heading('Kitchen dashboard'),
  DISPATCH: heading('Dispatch dashboard'),
  DRIVER: DriverDeliveries,
};

export default function DashboardPage() {
  const { data: me } = useMe();
  if (!me) return null;
  const Dashboard = DASHBOARDS[me.role];
  return <Dashboard />;
}
