'use client';

import { formatMoney } from '@fernleaf/shared';
import { Badge, Button, Group, Image, Table, Title, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RowLink } from '@/components/RowLink';
import { Waiting } from '@/components/Waiting';
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
        <div>
          <Title order={2}>Dishes</Title>
          <Text size="sm" c="dimmed">
            Everything the kitchen makes. Deactivated dishes stay on old orders but can’t be
            ordered.
          </Text>
        </div>
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
                  // Decorative: the name is right next to it, so screen readers skip it.
                  <Image src={dish.imageUrl} w={40} h={40} radius="sm" alt="" />
                )}
              </Table.Td>
              <Table.Td>{dish.sku}</Table.Td>
              <Table.Td>
                <RowLink href={`/dishes/${dish.id}`}>{dish.name}</RowLink>
              </Table.Td>
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
      {!dishes.data && <Waiting error={dishes.error} />}
    </>
  );
}
