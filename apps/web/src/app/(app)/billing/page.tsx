'use client';

import { formatMoney, type BillingCompany } from '@fernleaf/shared';
import { Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { RowLink } from '@/components/RowLink';
import { Waiting } from '@/components/Waiting';
import { api } from '@/lib/api';

export default function BillingPage() {
  const router = useRouter();
  const companies = useQuery({
    queryKey: ['billing'],
    queryFn: () => api<BillingCompany[]>('/billing/companies'),
  });

  return (
    <Stack>
      <div>
        <Title order={2}>Billing</Title>
        <Text size="sm" c="dimmed">
          What each company owes. Employees never pay: every confirmed order is billed to their
          company. Open a company to put what isn’t billed yet on an invoice.
        </Text>
      </div>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Company</Table.Th>
            <Table.Th ta="right">Orders not invoiced</Table.Th>
            <Table.Th ta="right">Not invoiced yet</Table.Th>
            <Table.Th ta="right">Unpaid invoices</Table.Th>
            <Table.Th ta="right">Owed on invoices</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {companies.data?.map((c) => (
            <Table.Tr
              key={c.id}
              style={{ cursor: 'pointer' }}
              onClick={() => router.push(`/billing/${c.id}`)}
            >
              <Table.Td>
                <RowLink href={`/billing/${c.id}`}>{c.name}</RowLink>
              </Table.Td>
              <Table.Td ta="right">{c.unbilledOrders}</Table.Td>
              <Table.Td ta="right">{formatMoney(c.unbilledAmount)}</Table.Td>
              <Table.Td ta="right">{c.unpaidInvoices}</Table.Td>
              <Table.Td ta="right">{formatMoney(c.unpaidAmount)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {!companies.data && <Waiting error={companies.error} />}
    </Stack>
  );
}
