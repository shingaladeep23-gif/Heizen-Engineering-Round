'use client';

import {
  companySchema,
  type CompanyDetail,
  type CompanyInput,
  type CompanyRow,
  type EmployeeInput,
  type Tier,
} from '@fernleaf/shared';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Radio,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  TagsInput,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import { useForm } from '@mantine/form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Holidays, WorkingDays } from '@/components/CalendarInputs';
import { EmployeeImport } from '@/components/EmployeeImport';
import { Waiting } from '@/components/Waiting';
import { api, useAction, useCan, useLists } from '@/lib/api';

type Form = Required<CompanyInput>;
type Employee = CompanyDetail['employees'][number];
type Category = { id: number; name: string; items: { id: number; dish: { name: string } }[] };

const EMPTY: Form = {
  name: '',
  domains: [],
  addresses: [{ label: '', text: '' }],
  defaultAddressIndex: 0,
  billingName: '',
  billingEmail: '',
  billingPhone: null,
  ownerId: null,
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
  deliveryTime: '12:30',
  dispatchLeadMinutes: 60,
  packagingTypeId: null,
  driverInstructions: '',
  defaultDriverId: null,
  priceTierId: null,
  hiddenCategoryIds: [],
  hiddenItemIds: [],
};

const options = (rows: { id: number; name: string }[] = []) =>
  rows.map((r) => ({ value: String(r.id), label: r.name }));
const asId = (v: string | null) => (v ? Number(v) : null);
const asValue = (id: number | null) => (id === null ? null : String(id));

function EmployeeDialog({
  companyId,
  employee,
  onClose,
}: {
  companyId: number;
  employee: Employee | null;
  onClose: () => void;
}) {
  const lists = useLists();
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api<CompanyRow[]>('/companies'),
  });
  const form = useForm<Required<EmployeeInput>>({
    initialValues: employee
      ? { ...employee, companyId }
      : {
          companyId,
          name: '',
          email: '',
          canChooseAddress: false,
          canChangeTime: false,
          canChangePackaging: false,
          allergyIds: [],
          dietaryIds: [],
        },
  });
  const save = useAction(
    (values: Required<EmployeeInput>) =>
      employee
        ? api(`/employees/${employee.id}`, { method: 'PUT', body: values })
        : api('/employees', { body: values }),
    { form, success: 'Employee saved', invalidate: ['company', 'employees'], onSuccess: onClose },
  );
  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
      <Stack>
        <TextInput label="Name" {...form.getInputProps('name')} />
        <TextInput label="Work email" {...form.getInputProps('email')} />
        {employee && (
          <Select
            label="Company"
            description="Moving someone changes their menu, prices and calendar from now on. Past orders stay where they were."
            data={options(companies.data)}
            value={String(form.values.companyId)}
            onChange={(v) => v && form.setFieldValue('companyId', Number(v))}
            allowDeselect={false}
          />
        )}
        <Switch
          label="Can choose their own delivery address"
          {...form.getInputProps('canChooseAddress', { type: 'checkbox' })}
        />
        <Switch
          label="Can change the delivery time"
          {...form.getInputProps('canChangeTime', { type: 'checkbox' })}
        />
        <Switch
          label="Can change packaging"
          {...form.getInputProps('canChangePackaging', { type: 'checkbox' })}
        />
        <MultiSelect
          label="Allergies"
          data={options(lists.data?.allergens)}
          value={form.values.allergyIds.map(String)}
          onChange={(v) => form.setFieldValue('allergyIds', v.map(Number))}
        />
        <MultiSelect
          label="Dietary preferences"
          data={options(lists.data?.['dietary-tags'])}
          value={form.values.dietaryIds.map(String)}
          onChange={(v) => form.setFieldValue('dietaryIds', v.map(Number))}
        />
        <Button type="submit" loading={save.isPending}>
          Save employee
        </Button>
      </Stack>
    </form>
  );
}

function CompanyForm({
  id,
  initial,
  employees,
  onSaved,
}: {
  id: number | null;
  initial: Form;
  employees: Employee[];
  onSaved?: () => void;
}) {
  const router = useRouter();
  const canEdit = useCan('companies.manage');
  const lists = useLists();
  const tiers = useQuery({ queryKey: ['tiers'], queryFn: () => api<Tier[]>('/tiers') });
  const drivers = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api<{ id: number; name: string }[]>('/dispatch/drivers'),
  });
  const menu = useQuery({ queryKey: ['menu'], queryFn: () => api<Category[]>('/menu/categories') });
  const form = useForm<Form>({ initialValues: initial });
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const queryClient = useQueryClient();
  const closeImport = () => {
    setImporting(false);
    queryClient.invalidateQueries({ queryKey: ['company'] }); // now show the new employees
    queryClient.invalidateQueries({ queryKey: ['employees'] });
  };

  const save = useAction(
    (values: Form) =>
      api<{ id: number }>(id ? `/companies/${id}` : '/companies', {
        method: id ? 'PUT' : 'POST',
        body: values,
      }),
    {
      form,
      success: 'Company saved',
      invalidate: ['companies'],
      onSuccess: (saved) => (id ? onSaved?.() : router.replace(`/companies/${saved.id}`)),
    },
  );
  const v = form.values;
  const items = (menu.data ?? []).flatMap((c) =>
    c.items.map((i) => ({ value: String(i.id), label: `${i.dish.name} (${c.name})` })),
  );

  return (
    <>
      <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
          <Stack>
            <Group justify="space-between">
              <Title order={2}>{id ? v.name : 'New company'}</Title>
              {canEdit && (
                <Button type="submit" loading={save.isPending}>
                  Save company
                </Button>
              )}
            </Group>

            <Card withBorder>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput label="Company name" {...form.getInputProps('name')} />
                <TagsInput
                  label="Email domains"
                  description="Press Enter after each. Public ones like gmail.com aren't allowed."
                  placeholder="acme.in"
                  {...form.getInputProps('domains')}
                  onChange={(domains) => {
                    form.setFieldValue('domains', domains);
                    // Say it as soon as a domain is added, with the same rule the
                    // server applies on save. (Domains other companies own can
                    // only be checked by the server.)
                    const check = companySchema.shape.domains.safeParse(domains);
                    form.setFieldError(
                      'domains',
                      check.success ? null : check.error.issues[0].message,
                    );
                  }}
                />
                <TextInput label="Billing name" {...form.getInputProps('billingName')} />
                <TextInput label="Billing email" {...form.getInputProps('billingEmail')} />
                <TextInput
                  label="Billing phone"
                  value={v.billingPhone ?? ''}
                  onChange={(e) =>
                    form.setFieldValue('billingPhone', e.currentTarget.value || null)
                  }
                />
                <Select
                  label="Owner"
                  description={
                    id ? 'One of the employees below' : 'Add employees first, then pick the owner'
                  }
                  clearable
                  data={options(employees)}
                  value={asValue(v.ownerId)}
                  onChange={(val) => form.setFieldValue('ownerId', asId(val))}
                  error={form.errors.ownerId}
                />
              </SimpleGrid>
            </Card>

            <Card withBorder>
              <Title order={4} mb="xs">
                Delivery addresses
              </Title>
              {form.errors.addresses && (
                <Text c="red" size="sm">
                  {form.errors.addresses}
                </Text>
              )}
              <Radio.Group
                value={String(v.defaultAddressIndex)}
                onChange={(val) => form.setFieldValue('defaultAddressIndex', Number(val))}
              >
                <Stack gap="xs">
                  {v.addresses.map((_, i) => (
                    <Group key={i} align="flex-end">
                      <Radio value={String(i)} label="Default" mb={8} />
                      <TextInput
                        label="Label"
                        placeholder="HQ, 4th floor"
                        w={200}
                        {...form.getInputProps(`addresses.${i}.label`)}
                      />
                      <TextInput
                        label="Full address"
                        style={{ flex: 1, minWidth: 220 }}
                        {...form.getInputProps(`addresses.${i}.text`)}
                      />
                      {v.addresses.length > 1 && (
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          mb={6}
                          aria-label={`Remove address ${i + 1}`}
                          onClick={() => {
                            form.removeListItem('addresses', i);
                            form.setFieldValue('defaultAddressIndex', 0);
                          }}
                        >
                          ×
                        </ActionIcon>
                      )}
                    </Group>
                  ))}
                </Stack>
              </Radio.Group>
              <Button
                variant="light"
                size="compact-sm"
                mt="sm"
                onClick={() => form.insertListItem('addresses', { label: '', text: '' })}
              >
                Add address
              </Button>
            </Card>

            <Card withBorder>
              <Title order={4} mb="xs">
                Calendar
              </Title>
              <Text size="sm" c="dimmed" mb="sm">
                No deliveries on days off or holidays. This doesn&apos;t move the order cut-off;
                only the kitchen calendar does.
              </Text>
              <Stack>
                <WorkingDays
                  value={v.workingDays}
                  onChange={(days) => form.setFieldValue('workingDays', days)}
                  error={form.errors.workingDays as string | undefined}
                />
                <Holidays
                  value={v.holidays}
                  onChange={(h) => form.setFieldValue('holidays', h)}
                  errors={form.errors}
                />
              </Stack>
            </Card>

            <Card withBorder>
              <Title order={4} mb="xs">
                Delivery defaults
              </Title>
              <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
                <TimeInput label="Delivery time" {...form.getInputProps('deliveryTime')} />
                <NumberInput
                  label="Leaves the kitchen (min before)"
                  min={0}
                  allowDecimal={false}
                  {...form.getInputProps('dispatchLeadMinutes')}
                />
                <Select
                  label="Packaging"
                  clearable
                  data={options(lists.data?.['packaging-types'])}
                  value={asValue(v.packagingTypeId)}
                  onChange={(val) => form.setFieldValue('packagingTypeId', asId(val))}
                />
                <Select
                  label="Default driver"
                  clearable
                  data={options(drivers.data)}
                  value={asValue(v.defaultDriverId)}
                  onChange={(val) => form.setFieldValue('defaultDriverId', asId(val))}
                  error={form.errors.defaultDriverId}
                />
              </SimpleGrid>
              <Textarea
                mt="sm"
                label="Standing instructions for the driver"
                {...form.getInputProps('driverInstructions')}
              />
            </Card>

            <Card withBorder>
              <Title order={4} mb="xs">
                Menu and price
              </Title>
              <SimpleGrid cols={{ base: 1, sm: 3 }}>
                <Select
                  label="Price tier"
                  placeholder="Default tier"
                  clearable
                  data={options(tiers.data)}
                  value={asValue(v.priceTierId)}
                  onChange={(val) => form.setFieldValue('priceTierId', asId(val))}
                />
                <MultiSelect
                  label="Hidden categories"
                  data={options(menu.data)}
                  value={v.hiddenCategoryIds.map(String)}
                  onChange={(val) => form.setFieldValue('hiddenCategoryIds', val.map(Number))}
                />
                <MultiSelect
                  label="Hidden dishes"
                  searchable
                  data={items}
                  value={v.hiddenItemIds.map(String)}
                  onChange={(val) => form.setFieldValue('hiddenItemIds', val.map(Number))}
                />
              </SimpleGrid>
            </Card>
          </Stack>
        </fieldset>
      </form>

      {/* Outside the company <form>: React passes a submit from the employee
          dialog up through its portal, which would save the company too. */}
      {id && (
        <Card withBorder mt="md">
          <Group justify="space-between" mb="xs">
            <Title order={4}>Employees ({employees.length})</Title>
            {canEdit && (
              <Group gap="xs">
                <Button variant="default" size="compact-sm" onClick={() => setImporting(true)}>
                  Import CSV
                </Button>
                <Button variant="light" size="compact-sm" onClick={() => setEditing('new')}>
                  Add employee
                </Button>
              </Group>
            )}
          </Group>
          <Table highlightOnHover>
            <Table.Tbody>
              {employees.map((e) => (
                <Table.Tr
                  key={e.id}
                  style={{ cursor: canEdit ? 'pointer' : undefined }}
                  onClick={() => canEdit && setEditing(e)}
                >
                  <Table.Td>
                    {e.name} {e.id === v.ownerId && <Badge size="xs">Owner</Badge>}
                  </Table.Td>
                  <Table.Td>{e.email}</Table.Td>
                  <Table.Td>
                    {[
                      e.canChooseAddress && 'address',
                      e.canChangeTime && 'time',
                      e.canChangePackaging && 'packaging',
                    ]
                      .filter(Boolean)
                      .map((p) => `can change ${p}`)
                      .join(', ')}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Modal
            opened={editing !== null}
            onClose={() => setEditing(null)}
            title={editing === 'new' ? 'New employee' : 'Edit employee'}
          >
            {editing !== null && (
              <EmployeeDialog
                companyId={id}
                employee={editing === 'new' ? null : editing}
                onClose={() => setEditing(null)}
              />
            )}
          </Modal>
          <Modal
            opened={importing}
            onClose={closeImport}
            title="Import employees from CSV"
            size="lg"
          >
            <EmployeeImport companyId={id} domains={initial.domains} />
          </Modal>
        </Card>
      )}
    </>
  );
}

export default function CompanyPage() {
  const params = useParams<{ id: string }>();
  const id = params.id === 'new' ? null : Number(params.id);
  const company = useQuery({
    queryKey: ['company', id],
    queryFn: () => api<CompanyDetail>(`/companies/${id}`),
    enabled: id !== null,
  });
  // The form starts from the saved company and is only rebuilt after the
  // company itself is saved (to pick up what the server assigned, like new
  // address ids). Reloads for other reasons, such as adding an employee,
  // just refresh the employee list and never throw away unsaved edits.
  const [version, setVersion] = useState(0);
  if (id === null) return <CompanyForm id={null} initial={EMPTY} employees={[]} />;
  if (!company.data) return <Waiting error={company.error} />;
  return (
    <CompanyForm
      key={version}
      id={id}
      initial={company.data}
      employees={company.data.employees}
      onSaved={async () => {
        await company.refetch();
        setVersion((v) => v + 1);
      }}
    />
  );
}
