'use client';

import type { ImportResult } from '@fernleaf/shared';
import { Alert, Code, FileInput, Stack, Table, Text } from '@mantine/core';
import { api, useAction } from '@/lib/api';

const EXAMPLE = `name,email,can_choose_address,can_change_time,can_change_packaging,allergies,dietary
Asha Rao,asha.rao@company.in,yes,no,no,Peanuts;Dairy,Vegetarian`;

// Bulk-add a company's employees from a CSV file. Good rows go in, and every
// bad row is listed with what's wrong, so the file never fails as a whole.
export function EmployeeImport({ companyId, domains }: { companyId: number; domains: string[] }) {
  const upload = useAction(
    async (file: File) =>
      api<ImportResult>(`/companies/${companyId}/employees/import`, {
        body: { csv: await file.text() },
      }),
    // No refresh here: refreshing the company redraws its page and would close
    // this dialog before anyone reads the report. The page refreshes on close.
    {},
  );
  const result = upload.data;

  return (
    <Stack>
      <Text size="sm">
        One employee per row, with a header row first. Only <b>name</b> and <b>email</b> are
        required; emails must be at {domains.map((d) => `@${d}`).join(' or ')}. Allergies and diets
        are separated by <Code>;</Code> and must match the reference lists.
      </Text>
      <Code block>{EXAMPLE}</Code>
      <FileInput
        label="CSV file"
        placeholder="Choose a .csv file"
        accept=".csv,text/csv"
        onChange={(file) => file && upload.mutate(file)}
        disabled={upload.isPending}
      />
      {result && (
        <>
          <Alert color={result.errors.length ? 'yellow' : 'green'}>
            Imported {result.created} employee(s).
            {result.errors.length > 0 && ` ${result.errors.length} row(s) were skipped:`}
          </Alert>
          {result.errors.length > 0 && (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Row</Table.Th>
                  <Table.Th>Email</Table.Th>
                  <Table.Th>Problem</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.errors.map((e) => (
                  <Table.Tr key={e.row}>
                    <Table.Td>{e.row}</Table.Td>
                    <Table.Td>{e.email}</Table.Td>
                    <Table.Td>{e.problems.join('. ')}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </>
      )}
    </Stack>
  );
}
