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
// The API checks every request on its own. Grouped by what people use them for.
const NAV: { href: string; label: string; section: string; permission?: Permission }[] = [
  { href: '/dashboard', label: 'Dashboard', section: 'Daily work' },
  { href: '/orders', label: 'Orders', section: 'Daily work', permission: 'orders.view' },
  { href: '/kitchen', label: 'Kitchen board', section: 'Daily work', permission: 'kitchen.view' },
  { href: '/dispatch', label: 'Dispatch', section: 'Daily work', permission: 'dispatch.view' },
  { href: '/billing', label: 'Billing', section: 'Daily work', permission: 'billing.view' },
  { href: '/companies', label: 'Companies', section: 'Customers', permission: 'companies.view' },
  { href: '/preview', label: 'Menu preview', section: 'Customers', permission: 'companies.view' },
  { href: '/dishes', label: 'Dishes', section: 'Catalogue', permission: 'catalogue.view' },
  { href: '/options', label: 'Options', section: 'Catalogue', permission: 'catalogue.view' },
  { href: '/menu', label: 'Menu', section: 'Catalogue', permission: 'catalogue.view' },
  { href: '/tiers', label: 'Price tiers', section: 'Catalogue', permission: 'catalogue.view' },
  { href: '/lists', label: 'Reference lists', section: 'Catalogue', permission: 'catalogue.view' },
  { href: '/staff', label: 'Staff', section: 'Admin', permission: 'staff.manage' },
  { href: '/settings', label: 'Settings', section: 'Admin', permission: 'settings.manage' },
];

const roleName = (role: string) => role.charAt(0) + role.slice(1).toLowerCase();

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

  // The browser tab names the page, which helps with several tabs open.
  useEffect(() => {
    const page = NAV.find((n) => pathname === n.href || pathname.startsWith(`${n.href}/`));
    document.title = page ? `${page.label} · Fernleaf Kitchen` : 'Fernleaf Kitchen';
  }, [pathname]);

  if (!me.data) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  const links = NAV.filter((item) => !item.permission || can(me.data.role, item.permission));
  const sections = [...new Set(links.map((item) => item.section))];

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
              {me.data.name} · {roleName(me.data.role)}
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

      {/* Scrolls on its own, so the last links are reachable on a short screen. */}
      <AppShell.Navbar p="xs" style={{ overflowY: 'auto' }}>
        {sections.map((section) => (
          <div key={section}>
            {sections.length > 1 && (
              <Text size="xs" fw={600} c="dimmed" tt="uppercase" px="sm" mt="sm" mb={4}>
                {section}
              </Text>
            )}
            {links
              .filter((item) => item.section === section)
              .map((item) => (
                <NavLink
                  key={item.href}
                  component={Link}
                  href={item.href}
                  label={item.label}
                  active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
                  onClick={close}
                />
              ))}
          </div>
        ))}
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
