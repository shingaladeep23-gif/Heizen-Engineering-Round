'use client';

import { formatMoney } from '@fernleaf/shared';
import { Badge, Button, Group, Image, Table, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, useCan } from '@/lib/api';

type DishRow = {
  id: number;
  sku: string;
  name: string;
  temperature: 'HOT' | 'COLD';
  costPrice: number;
  active: boolean;
  imageUrl: string | null;
  station: { name: string } | null;
};

export default function DishesPage() {
  const router = useRouter();
  const canEdit = useCan('catalogue.manage');
  const dishes = useQuery({ queryKey: ['dishes'], queryFn: () => api<DishRow[]>('/dishes') });

  return (
    <>
      <Group justify="space-between" mb="md">
        <Title order={2}>Dishes</Title>
        {canEdit && (
          <Button component={Link} href="/dishes/new">
            New dish
          </Button>
        )}
      </Group>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={56} />
            <Table.Th>SKU</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>Station</Table.Th>
            <Table.Th>Temp</Table.Th>
            <Table.Th>Cost</Table.Th>
            <Table.Th>Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {dishes.data?.map((dish) => (
            <Table.Tr
              key={dish.id}
              style={{ cursor: 'pointer', opacity: dish.active ? 1 : 0.5 }}
              onClick={() => router.push(`/dishes/${dish.id}`)}
            >
              <Table.Td>
                {dish.imageUrl && (
                  <Image src={dish.imageUrl} w={40} h={40} radius="sm" alt={dish.name} />
                )}
              </Table.Td>
              <Table.Td>{dish.sku}</Table.Td>
              <Table.Td>{dish.name}</Table.Td>
              <Table.Td>{dish.station?.name ?? 'Unassigned'}</Table.Td>
              <Table.Td>{dish.temperature === 'HOT' ? 'Hot' : 'Cold'}</Table.Td>
              <Table.Td>{formatMoney(dish.costPrice)}</Table.Td>
              <Table.Td>
                <Badge color={dish.active ? 'green' : 'gray'} variant="light">
                  {dish.active ? 'Active' : 'Deactivated'}
                </Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </>
  );
}
