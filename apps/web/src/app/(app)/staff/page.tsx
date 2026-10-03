'use client';

import { ROLES, type Me, type Role, type StaffInput } from '@fernleaf/shared';
import {
  Badge,
  Button,
  Group,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';
import { api, useAction, useMe } from '@/lib/api';

type StaffMember = Me & { active: boolean };

function StaffRow({ member, isMe }: { member: StaffMember; isMe: boolean }) {
  const save = useAction(
    (changes: { role: Role; active: boolean }) =>
      api(`/staff/${member.id}`, { method: 'PUT', body: changes }),
    { success: `${member.name} updated`, invalidate: ['staff'] },
  );
  return (
    <Table.Tr style={{ opacity: member.active ? 1 : 0.5 }}>
      <Table.Td>
        {member.name} {isMe && <Badge size="xs">You</Badge>}
      </Table.Td>
      <Table.Td>{member.email}</Table.Td>
      <Table.Td>
        <Select
          size="xs"
          w={130}
          aria-label={`Role for ${member.email}`}
          data={[...ROLES]}
          allowDeselect={false}
          disabled={isMe}
          value={member.role}
          onChange={(role) => role && save.mutate({ role: role as Role, active: member.active })}
        />
      </Table.Td>
      <Table.Td>
        <Switch
          aria-label={`${member.email} can sign in`}
          label={member.active ? 'Active' : 'Switched off'}
          disabled={isMe}
          checked={member.active}
          onChange={(e) => save.mutate({ role: member.role, active: e.currentTarget.checked })}
        />
      </Table.Td>
    </Table.Tr>
  );
}

export default function StaffPage() {
  const { data: me } = useMe();
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => api<StaffMember[]>('/staff') });
  const form = useForm<StaffInput>({
    initialValues: { name: '', email: '', password: '', role: 'KITCHEN' },
  });
  const create = useAction((values: StaffInput) => api<Me>('/staff', { body: values }), {
    form,
    invalidate: ['staff'],
    onSuccess: () => form.reset(),
    success: 'Staff member added. They can sign in now.',
  });

  return (
    <Stack>
      <Title order={2}>Staff</Title>

      <Paper withBorder p="md">
        <form onSubmit={form.onSubmit((values) => create.mutate(values))}>
          <Group align="flex-end">
            <TextInput label="Name" {...form.getInputProps('name')} />
            <TextInput label="Email" {...form.getInputProps('email')} />
            <PasswordInput label="Password" w={180} {...form.getInputProps('password')} />
            <Select
              label="Role"
              data={[...ROLES]}
              allowDeselect={false}
              w={140}
              {...form.getInputProps('role')}
            />
            <Button type="submit" loading={create.isPending}>
              Add staff member
            </Button>
          </Group>
        </form>
      </Paper>

      <Text size="sm" c="dimmed">
        Switching someone off stops them signing in straight away. Nothing they did is lost, and
        they can be switched back on.
      </Text>
      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Email</Table.Th>
            <Table.Th>Role</Table.Th>
            <Table.Th>Can sign in</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {staff.data?.map((member) => (
            <StaffRow key={member.id} member={member} isMe={member.id === me?.id} />
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
