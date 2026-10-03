'use client';

import type { CompanyRow } from '@fernleaf/shared';
import { Button, Group, Table, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
        <Title order={2}>Companies</Title>
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
              <Table.Td>{c.name}</Table.Td>
              <Table.Td>{c.domains.map((d) => `@${d}`).join(', ')}</Table.Td>
              <Table.Td>{c.tier ?? 'Default tier'}</Table.Td>
              <Table.Td ta="right">{c.employees}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </>
  );
}
