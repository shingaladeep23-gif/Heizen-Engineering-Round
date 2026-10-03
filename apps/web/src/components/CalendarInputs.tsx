'use client';

import { ActionIcon, Button, Checkbox, Group, Stack, Text, TextInput } from '@mantine/core';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ISO weekdays: 1 = Monday ... 7 = Sunday.
export function WorkingDays({
  value,
  onChange,
  error,
}: {
  value: number[];
  onChange: (days: number[]) => void;
  error?: string;
}) {
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>
        Working days
      </Text>
      <Checkbox.Group
        value={value.map(String)}
        onChange={(v) => onChange(v.map(Number))}
        error={error}
      >
        <Group gap="sm">
          {DAYS.map((day, i) => (
            <Checkbox key={day} value={String(i + 1)} label={day} />
          ))}
        </Group>
      </Checkbox.Group>
    </Stack>
  );
}

type Holiday = { date: string; name: string };

// `errors` is the form's errors object; the API names them holidays.0.date etc.
export function Holidays({
  value,
  onChange,
  errors = {},
}: {
  value: Holiday[];
  onChange: (h: Holiday[]) => void;
  errors?: Record<string, unknown>;
}) {
  const error = (i: number, field: keyof Holiday) =>
    errors[`holidays.${i}.${field}`] as string | undefined;
  const set = (i: number, change: Partial<Holiday>) =>
    onChange(value.map((h, j) => (j === i ? { ...h, ...change } : h)));
  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        Holidays
      </Text>
      {value.map((holiday, i) => (
        <Group key={i} gap="xs" align="flex-start">
          <TextInput
            type="date"
            aria-label={`Holiday ${i + 1} date`}
            value={holiday.date}
            onChange={(e) => set(i, { date: e.currentTarget.value })}
            error={error(i, 'date')}
          />
          <TextInput
            aria-label={`Holiday ${i + 1} name`}
            placeholder="e.g. Diwali"
            value={holiday.name}
            onChange={(e) => set(i, { name: e.currentTarget.value })}
            error={error(i, 'name')}
          />
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label={`Remove holiday ${i + 1}`}
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            ×
          </ActionIcon>
        </Group>
      ))}
      <Button
        variant="light"
        size="compact-sm"
        w="fit-content"
        onClick={() => onChange([...value, { date: '', name: '' }])}
      >
        Add holiday
      </Button>
    </Stack>
  );
}
