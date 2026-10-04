'use client';

import { formatMoney, type AdminDashboard as Data } from '@fernleaf/shared';
import { Alert, Card, Group, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Stat } from '@/components/Stat';
import { Waiting } from '@/components/Waiting';
import { api } from '@/lib/api';
import { formatDay } from '@/lib/format';

const percent = (part: number, whole: number) =>
  whole === 0 ? 'No data' : `${Math.round((part / whole) * 100)}%`;

export function AdminDashboard() {
  const query = useQuery({
    queryKey: ['dashboard', 'admin'],
    queryFn: () => api<Data>('/dashboard/admin'),
  });
  if (!query.data) return <Waiting error={query.error} />;
  const { today, upcoming, money, lastWeek, topDishes, tiersMissingPrices } = query.data;

  return (
    <Stack>
      <Title order={2}>Admin dashboard</Title>

      {(today.lateDrops > 0 || money.overdueInvoices > 0 || tiersMissingPrices.length > 0) && (
        <Alert color="orange" title="Needs a decision">
          <Stack gap={2}>
            {today.lateDrops > 0 && (
              <Text size="sm">
                {today.lateDrops} drop(s) running late today.{' '}
                <Link href="/dispatch">Dispatch board</Link>
              </Text>
            )}
            {money.overdueInvoices > 0 && (
              <Text size="sm">
                {money.overdueInvoices} invoice(s) unpaid for more than 14 days.{' '}
                <Link href="/billing">Billing</Link>
              </Text>
            )}
            {tiersMissingPrices.map((t) => (
              <Text key={t.name} size="sm">
                {t.missing} active dish(es) can&apos;t be ordered on {t.name} (a missing price on the
                dish or on every option of a required choice), so its companies don&apos;t see
                them. <Link href="/tiers">Price tiers</Link>
              </Text>
            ))}
          </Stack>
        </Alert>
      )}

      <Title order={4}>Today, {formatDay(today.date)}</Title>
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Stat label="Orders today" value={today.orders} hint="Confirmed and delivered" />
        <Stat label="Value today" value={formatMoney(today.value)} />
        <Stat label="Delivered so far" value={`${today.delivered} of ${today.orders}`} />
        <Stat
          label="Drops running late"
          value={today.lateDrops}
          color={today.lateDrops ? 'red' : undefined}
        />
      </SimpleGrid>

      <Title order={4}>Money</Title>
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Stat
          label="Not invoiced yet"
          value={formatMoney(money.unbilled)}
          hint="Billable orders plus credits"
        />
        <Stat
          label="Unpaid invoices"
          value={formatMoney(money.unpaid)}
          hint={`${money.unpaidInvoices} invoice(s), ${money.overdueInvoices} overdue`}
        />
        <Stat label="Paid in the last 30 days" value={formatMoney(money.paidLast30Days)} />
        <Stat
          label="Booked for the next 7 days"
          value={formatMoney(upcoming.value)}
          hint="Confirmed and placed"
        />
      </SimpleGrid>

      <Group align="flex-start" grow>
        <Card withBorder>
          <Title order={5} mb="xs">
            Last 7 days ({formatDay(lastWeek.from)} to {formatDay(lastWeek.to)})
          </Title>
          <SimpleGrid cols={2}>
            <Stat label="Orders" value={lastWeek.orders} />
            <Stat label="Revenue" value={formatMoney(lastWeek.revenue)} />
            <Stat
              label="On time"
              value={percent(lastWeek.onTime, lastWeek.delivered)}
              hint={`${lastWeek.onTime} of ${lastWeek.delivered} deliveries`}
            />
            <Stat
              label="Cancelled / rejected"
              value={`${lastWeek.cancelled} / ${lastWeek.rejected}`}
            />
          </SimpleGrid>
        </Card>
        <Card withBorder>
          <Title order={5} mb="xs">
            Most ordered, last 7 days
          </Title>
          <Table>
            <Table.Tbody>
              {topDishes.map((d) => (
                <Table.Tr key={d.name}>
                  <Table.Td>{d.name}</Table.Td>
                  <Table.Td ta="right">{d.portions} portions</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {topDishes.length === 0 && <Text c="dimmed">No deliveries last week.</Text>}
          <Text size="xs" c="dimmed" mt="xs">
            Coming up: {upcoming.confirmed} confirmed, {upcoming.placed} placed and{' '}
            {upcoming.drafts} draft orders over the next 7 days.
          </Text>
        </Card>
      </Group>
    </Stack>
  );
}
