import { checkRows, parseCsv } from './employee-import.js';

const ctx = {
  domains: ['acme.in'],
  existingEmails: new Set(['taken@acme.in']),
  allergens: new Map([
    ['peanuts', 1],
    ['dairy', 2],
  ]),
  dietaryTags: new Map([['vegan', 10]]),
};

describe('parseCsv', () => {
  it('handles quotes, commas and doubled quotes inside them, and Windows line endings', () => {
    expect(parseCsv('a,b\r\n"Rao, Kavya","say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['Rao, Kavya', 'say "hi"'],
    ]);
  });
});

describe('checkRows', () => {
  const file = [
    'Name,Email,can_choose_address,can_change_time,can_change_packaging,allergies,dietary',
    'Asha Rao,asha@acme.in,yes,no,1,Peanuts; dairy,Vegan',
    'No Domain,someone@gmail.com,,,,,',
    'Dup,taken@acme.in,,,,,',
    ',noname@acme.in,maybe,,,Shellfish,',
    '',
    'Vik Rao,VIK@acme.in,,,,,',
    'Vik Again,vik@acme.in,,,,,',
  ].join('\n');

  it('imports the good rows and reports every bad one with its line number', () => {
    const { rows, errors } = checkRows(file, ctx);
    expect(rows.map((r) => r.email)).toEqual(['asha@acme.in', 'vik@acme.in']);
    expect(rows[0]).toMatchObject({
      canChooseAddress: true,
      canChangeTime: false,
      canChangePackaging: true,
      allergyIds: [1, 2],
      dietaryIds: [10],
    });
    expect(errors).toEqual([
      { row: 3, email: 'someone@gmail.com', problems: ['Email must be at @acme.in'] },
      { row: 4, email: 'taken@acme.in', problems: ['Already an employee'] },
      {
        row: 5,
        email: 'noname@acme.in',
        problems: [
          'Name is missing',
          'can_choose_address should be yes or no',
          'Unknown allergy "Shellfish"',
        ],
      },
      { row: 8, email: 'vik@acme.in', problems: ['Same email earlier in the file'] },
    ]);
  });

  it('needs name and email columns', () => {
    const { rows, errors } = checkRows('first,last\nA,B', ctx);
    expect(rows).toEqual([]);
    expect(errors[0].problems[0]).toMatch(/"name" and "email"/);
  });
});
