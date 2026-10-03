'use client';

import { formatMoney, type EmployeeMenu, type PricedDish } from '@fernleaf/shared';
import {
  Alert,
  Badge,
  Card,
  Group,
  Image,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';

type Employee = { id: number; name: string; email: string; company: { name: string } };

function DishCard({ dish }: { dish: PricedDish }) {
  return (
    <Card withBorder>
      {dish.imageUrl && (
        <Card.Section mb="sm">
          <Image src={dish.imageUrl} h={140} alt={dish.name} />
        </Card.Section>
      )}
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Text fw={600}>{dish.name}</Text>
        <Text fw={600}>{formatMoney(dish.price)}</Text>
      </Group>
      <Text size="sm" c="dimmed" mb="xs">
        {dish.description}
      </Text>
      <Group gap={4} mb="xs">
        {dish.dietaryTags.map((tag) => (
          <Badge key={tag} size="xs" variant="light" color="green" tt="none">
            {tag}
          </Badge>
        ))}
        {dish.allergens.map((a) => (
          <Badge key={a} size="xs" variant="outline" color="gray" tt="none">
            {a}
          </Badge>
        ))}
        {dish.minOrderQty && (
          <Badge size="xs" variant="light" tt="none">
            Min {dish.minOrderQty}
          </Badge>
        )}
      </Group>
      {dish.warnings.map((w) => (
        <Text key={w} size="xs" c="orange.8">
          ⚠ {w}
        </Text>
      ))}
      {dish.groups.map((group) => (
        <Text key={group.id} size="xs" mt={4}>
          <b>
            {group.name}
            {group.required ? '' : ' (optional)'}
            {group.maxChoices > 1 ? `, up to ${group.maxChoices}` : ''}:
          </b>{' '}
          {group.options
            .map(
              (o) =>
                `${o.name} +${formatMoney(o.price)}${o.warnings.length ? ` ⚠ ${o.warnings.join(', ')}` : ''}`,
            )
            .join(' · ')}
        </Text>
      ))}
    </Card>
  );
}

export default function PreviewPage() {
  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: () => api<Employee[]>('/employees'),
  });
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [secretId, setSecretId] = useState<string | null>(null);
  const menu = useQuery({
    queryKey: ['preview', employeeId, secretId],
    queryFn: () =>
      api<EmployeeMenu>(
        `/menu/preview?employeeId=${employeeId}${secretId ? `&categoryId=${secretId}` : ''}`,
      ),
    enabled: employeeId !== null,
  });

  // Group the picker by company so it's quick to find someone.
  const byCompany = Object.entries(Object.groupBy(employees.data ?? [], (e) => e.company.name)).map(
    ([group, list]) => ({
      group,
      items: (list ?? []).map((e) => ({ value: String(e.id), label: `${e.name} (${e.email})` })),
    }),
  );

  return (
    <Stack>
      <Title order={2}>Menu preview</Title>
      <Text size="sm" c="dimmed">
        See the menu exactly as one employee would: their company&apos;s hidden items are gone,
        prices come from their company&apos;s tier, and anything without a price there isn&apos;t
        shown.
      </Text>
      <Group align="flex-end">
        <Select
          label="Employee"
          placeholder="Pick an employee"
          searchable
          data={byCompany}
          value={employeeId}
          onChange={(v) => {
            setEmployeeId(v);
            setSecretId(null);
          }}
          w={420}
        />
        {menu.data && menu.data.secretCategories.length > 0 && (
          <Select
            label="Open a secret category"
            placeholder="None"
            clearable
            data={menu.data.secretCategories.map((c) => ({ value: String(c.id), label: c.name }))}
            value={secretId}
            onChange={setSecretId}
          />
        )}
      </Group>

      {menu.data && (
        <>
          <Text>
            <b>{menu.data.employee.name}</b> at {menu.data.employee.companyName}, priced on the{' '}
            <b>{menu.data.tierName}</b> tier.
          </Text>
          {menu.data.categories.length === 0 && (
            <Alert color="yellow">Nothing on the menu for this employee.</Alert>
          )}
          {menu.data.categories.map((category) => (
            <Stack key={category.id} gap="xs">
              <Title order={4}>
                {category.name} {category.secret && <Badge color="grape">Secret</Badge>}
              </Title>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
                {category.dishes.map((dish) => (
                  <DishCard key={dish.id} dish={dish} />
                ))}
              </SimpleGrid>
            </Stack>
          ))}
        </>
      )}
    </Stack>
  );
}
