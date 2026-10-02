'use client';

import type { Role } from '@fernleaf/shared';
import { Title } from '@mantine/core';
import { useMe } from '@/lib/api';

const TITLES: Record<Role, string> = {
  ADMIN: 'Admin dashboard',
  KITCHEN: 'Kitchen dashboard',
  DISPATCH: 'Dispatch dashboard',
  DRIVER: "Today's deliveries",
};

export default function DashboardPage() {
  const { data: me } = useMe();
  return me && <Title order={2}>{TITLES[me.role]}</Title>;
}
