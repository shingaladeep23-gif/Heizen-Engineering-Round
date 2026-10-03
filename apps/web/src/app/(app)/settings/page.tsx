'use client';

import type { SettingsInput } from '@fernleaf/shared';
import { Button, Card, NumberInput, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';
import { Holidays, WorkingDays } from '@/components/CalendarInputs';
import { Waiting } from '@/components/Waiting';
import { api, useAction } from '@/lib/api';

type Settings = Required<SettingsInput>;

function SettingsForm({ initial }: { initial: Settings }) {
  const form = useForm<Settings>({ initialValues: initial });
  const save = useAction((values: Settings) => api('/settings', { method: 'PUT', body: values }), {
    form,
    success: 'Settings saved',
    invalidate: ['settings'],
  });
  const minutes = (field: keyof Settings, label: string, description: string) => (
    <NumberInput
      label={label}
      description={description}
      min={0}
      allowDecimal={false}
      {...form.getInputProps(field)}
    />
  );

  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
      <Stack>
        <Card withBorder>
          <Title order={4} mb="sm">
            Kitchen calendar
          </Title>
          <Stack>
            <WorkingDays
              value={form.values.kitchenWorkingDays}
              onChange={(days) => form.setFieldValue('kitchenWorkingDays', days)}
              error={form.errors.kitchenWorkingDays as string | undefined}
            />
            <Holidays
              value={form.values.holidays}
              onChange={(h) => form.setFieldValue('holidays', h)}
              errors={form.errors}
            />
          </Stack>
        </Card>

        <Card withBorder>
          <Title order={4}>Order cut-off</Title>
          <Text size="sm" c="dimmed" mb="sm">
            Orders lock at this time, this many kitchen working days before delivery. Kitchen
            holidays and days off are skipped when counting back.
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TimeInput label="Cut-off time" {...form.getInputProps('cutoffTime')} />
            <NumberInput
              label="Working days before delivery"
              min={0}
              allowDecimal={false}
              {...form.getInputProps('cutoffDays')}
            />
          </SimpleGrid>
        </Card>

        <Card withBorder>
          <Title order={4} mb="sm">
            Timings
          </Title>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            {minutes(
              'kitchenBufferMinutes',
              'Kitchen buffer (min)',
              'Cooked this long before it must leave',
            )}
            {minutes(
              'atRiskMinutes',
              'At-risk window (min)',
              'Flag unfinished work this close to its ready time',
            )}
            {minutes(
              'onTimeGraceMinutes',
              'On-time grace (min)',
              'Delivered within this counts as on time',
            )}
          </SimpleGrid>
        </Card>

        <Button type="submit" loading={save.isPending} w="fit-content">
          Save settings
        </Button>
      </Stack>
    </form>
  );
}

export default function SettingsPage() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/settings') });
  return (
    <>
      <Title order={2}>Settings</Title>
      <Text size="sm" c="dimmed" mb="md">
        Platform-wide values: the kitchen’s own calendar, when orders lock, and the timings the
        boards use.
      </Text>
      {settings.data ? (
        <SettingsForm initial={settings.data} />
      ) : (
        <Waiting error={settings.error} />
      )}
    </>
  );
}
