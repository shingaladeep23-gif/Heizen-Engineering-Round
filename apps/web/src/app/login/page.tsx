'use client';

import type { LoginInput, Me } from '@fernleaf/shared';
import {
  Alert,
  Button,
  Center,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const form = useForm<LoginInput>({
    initialValues: { email: '', password: '' },
  });

  const login = useMutation({
    mutationFn: (values: LoginInput) => api<Me>('/auth/login', { body: values }),
    onSuccess: (me) => {
      queryClient.setQueryData(['me'], me);
      router.replace('/dashboard');
    },
    onError: (error) => form.setErrors(error instanceof ApiError ? error.fieldErrors : {}),
  });

  return (
    <Center h="100vh" bg="gray.0">
      <Paper withBorder p="xl" w={360}>
        <form onSubmit={form.onSubmit((values) => login.mutate(values))}>
          <Title order={3}>Fernleaf Kitchen</Title>
          <Text c="dimmed" size="sm" mb="lg">
            Staff sign in
          </Text>
          <Stack>
            <TextInput label="Email" autoComplete="email" {...form.getInputProps('email')} />
            <PasswordInput
              label="Password"
              autoComplete="current-password"
              {...form.getInputProps('password')}
            />
            {login.error && <Alert color="red">{login.error.message}</Alert>}
            <Button type="submit" loading={login.isPending}>
              Sign in
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
