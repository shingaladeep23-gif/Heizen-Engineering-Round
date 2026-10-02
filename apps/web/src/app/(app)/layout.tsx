'use client';

import { can, type Permission } from '@fernleaf/shared';
import {
  AppShell,
  Burger,
  Button,
  Center,
  Group,
  Loader,
  NavLink,
  Text,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { api, useMe } from '@/lib/api';

// Links are hidden when you lack the permission, but that's only for tidiness.
// The API checks every request on its own.
const NAV: { href: string; label: string; permission?: Permission }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/staff', label: 'Staff', permission: 'staff.manage' },
];

export default function SignedInLayout({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [menuOpen, { toggle, close }] = useDisclosure();

  useEffect(() => {
    if (me.error) router.replace('/login');
  }, [me.error, router]);

  if (!me.data) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' });
    queryClient.clear();
    router.replace('/login');
  };

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{
        width: 220,
        breakpoint: 'sm',
        collapsed: { mobile: !menuOpen },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <Burger
              opened={menuOpen}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
            />
            <Text fw={700}>Fernleaf Kitchen</Text>
          </Group>
          <Group gap="xs">
            <Text size="sm" c="dimmed" visibleFrom="xs">
              {me.data.name}
            </Text>
            <Button variant="subtle" size="xs" onClick={signOut}>
              Sign out
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {NAV.filter(
          (item) => !item.permission || can(me.data.role, item.permission),
        ).map((item) => (
          <NavLink
            key={item.href}
            component={Link}
            href={item.href}
            label={item.label}
            active={pathname.startsWith(item.href)}
            onClick={close}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
