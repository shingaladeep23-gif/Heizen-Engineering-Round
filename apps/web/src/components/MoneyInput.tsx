import { toPaise } from '@fernleaf/shared';
import { NumberInput, type NumberInputProps } from '@mantine/core';

type Props = Omit<NumberInputProps, 'value' | 'onChange'> & {
  value: number | null; // paise
  onChange: (paise: number | null) => void;
};

// Staff type rupees; the app stores paise.
export function MoneyInput({ value, onChange, ...props }: Props) {
  return (
    <NumberInput
      prefix="₹"
      decimalScale={2}
      min={0}
      thousandSeparator=","
      value={value === null ? '' : value / 100}
      onChange={(v) => onChange(v === '' ? null : toPaise(Number(v)))}
      {...props}
    />
  );
}
