'use client';

import { ROLES, type Me, type StaffInput } from '@fernleaf/shared';
import {
  Badge,
  Button,
  Group,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Table,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';

type StaffMember = Me & { active: boolean };

export default function StaffPage() {
  const queryClient = useQueryClient();
  const staff = useQuery({
    queryKey: ['staff'],
    queryFn: () => api<StaffMember[]>('/staff'),
  });
  const form = useForm<StaffInput>({
    initialValues: { name: '', email: '', password: '', role: 'KITCHEN' },
  });

  const create = useMutation({
    mutationFn: (values: StaffInput) => api<Me>('/staff', { body: values }),
    onSuccess: (member) => {
      notifications.show({
        color: 'green',
        message: `${member.name} can now sign in`,
      });
      form.reset();
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
    onError: (error) => {
      form.setErrors(error instanceof ApiError ? error.fieldErrors : {});
      notifications.show({ color: 'red', message: error.message });
    },
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

      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Email</Table.Th>
            <Table.Th>Role</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {staff.data?.map((member) => (
            <Table.Tr key={member.id}>
              <Table.Td>{member.name}</Table.Td>
              <Table.Td>{member.email}</Table.Td>
              <Table.Td>
                <Badge variant="light">{member.role}</Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
