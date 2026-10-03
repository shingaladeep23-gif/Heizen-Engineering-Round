'use client';

import { can, type Permission } from '@fernleaf/shared';
import {
  Alert,
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
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { api, useMe } from '@/lib/api';

// Links are hidden when you lack the permission, but that's only for tidiness.
// The API checks every request on its own.
const NAV: { href: string; label: string; permission?: Permission }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/orders', label: 'Orders', permission: 'orders.view' },
  { href: '/kitchen', label: 'Kitchen board', permission: 'kitchen.view' },
  { href: '/dispatch', label: 'Dispatch', permission: 'dispatch.view' },
  { href: '/billing', label: 'Billing', permission: 'billing.view' },
  { href: '/companies', label: 'Companies', permission: 'companies.view' },
  { href: '/dishes', label: 'Dishes', permission: 'catalogue.view' },
  { href: '/options', label: 'Options', permission: 'catalogue.view' },
  { href: '/menu', label: 'Menu', permission: 'catalogue.view' },
  { href: '/preview', label: 'Menu preview', permission: 'companies.view' },
  { href: '/tiers', label: 'Price tiers', permission: 'catalogue.view' },
  { href: '/lists', label: 'Reference lists', permission: 'catalogue.view' },
  { href: '/staff', label: 'Staff', permission: 'staff.manage' },
  { href: '/settings', label: 'Settings', permission: 'settings.manage' },
];

// What each page needs. Pages that need more than their menu entry come
// first; the rest are the menu entries themselves (a page and its sub-pages).
const PAGES: [RegExp, Permission][] = [
  [/^\/orders\/(new|\d+\/edit)$/, 'orders.manage'],
  [/^\/companies\/new$/, 'companies.manage'],
  [/^\/dishes\/new$/, 'catalogue.manage'],
  [/^\/invoices\//, 'billing.view'],
  ...NAV.flatMap(({ href, permission }): [RegExp, Permission][] =>
    permission ? [[new RegExp(`^${href}(/|$)`), permission]] : [],
  ),
];

export default function SignedInLayout({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [menuOpen, { toggle, close }] = useDisclosure();

  // The cookie is httpOnly, so only the API can clear it. If that call fails
  // we say so, rather than pretending you're signed out.
  const signOut = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.clear();
      router.replace('/login');
    },
    onError: (error) =>
      notifications.show({
        color: 'red',
        message: `Couldn't sign out: ${error.message}`,
      }),
  });

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
            <Burger opened={menuOpen} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Text fw={700}>Fernleaf Kitchen</Text>
          </Group>
          <Group gap="xs">
            <Text size="sm" c="dimmed" visibleFrom="xs">
              {me.data.name}
            </Text>
            <Button
              variant="subtle"
              size="xs"
              loading={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              Sign out
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {NAV.filter((item) => !item.permission || can(me.data.role, item.permission)).map(
          (item) => (
            <NavLink
              key={item.href}
              component={Link}
              href={item.href}
              label={item.label}
              active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
              onClick={close}
            />
          ),
        )}
      </AppShell.Navbar>

      <AppShell.Main>
        {/* Saves loading a page only to show its errors. The API still checks everything. */}
        {PAGES.some(
          ([page, permission]) => page.test(pathname) && !can(me.data.role, permission),
        ) ? (
          <Alert color="red" title="No access">
            You don&apos;t have access to this page.
          </Alert>
        ) : (
          children
        )}
      </AppShell.Main>
    </AppShell>
  );
}
