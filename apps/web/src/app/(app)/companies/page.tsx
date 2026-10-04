'use client';

import type { CompanyRow } from '@fernleaf/shared';
import { Button, Group, Table, Title, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RowLink } from '@/components/RowLink';
import { Waiting } from '@/components/Waiting';
import { api, useCan } from '@/lib/api';

export default function CompaniesPage() {
  const router = useRouter();
  const canEdit = useCan('companies.manage');
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api<CompanyRow[]>('/companies'),
  });

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={2}>Companies</Title>
          <Text size="sm" c="dimmed">
            The companies we deliver to. Open one for its employees, addresses, calendar, delivery
            defaults and prices.
          </Text>
        </div>
        {canEdit && (
          <Button component={Link} href="/companies/new">
            New company
          </Button>
        )}
      </Group>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Company</Table.Th>
            <Table.Th>Email domains</Table.Th>
            <Table.Th>Price tier</Table.Th>
            <Table.Th ta="right">Employees</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {companies.data?.map((c) => (
            <Table.Tr
              key={c.id}
              style={{ cursor: 'pointer' }}
              onClick={() => router.push(`/companies/${c.id}`)}
            >
              <Table.Td>
                <RowLink href={`/companies/${c.id}`}>{c.name}</RowLink>
              </Table.Td>
              <Table.Td>{c.domains.map((d) => `@${d}`).join(', ')}</Table.Td>
              <Table.Td>{c.tier ?? 'Default tier'}</Table.Td>
              <Table.Td ta="right">{c.employees}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {!companies.data && <Waiting error={companies.error} />}
    </>
  );
}
