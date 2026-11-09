'use client';

export function formatGuineaBissauPhone(value) {
  const raw = String(value || '');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  let nationalNumber = digits;
  while (nationalNumber.startsWith('00245') || nationalNumber.startsWith('245')) {
    nationalNumber = nationalNumber.startsWith('00245')
      ? nationalNumber.slice(5)
      : nationalNumber.slice(3);
  }

  return nationalNumber ? `+245 ${nationalNumber}` : '+245';
}

export function isValidGuineaBissauPhone(value) {
  const formatted = formatGuineaBissauPhone(value);
  const nationalDigits = formatted.replace(/\D/g, '').replace(/^245/, '');
  return nationalDigits.length >= 7;
}

export default function GuineaBissauPhoneInput({ value, onChange, ...props }) {
  return (
    <input
      {...props}
      type="tel"
      value={formatGuineaBissauPhone(value)}
      onChange={(event) => onChange(formatGuineaBissauPhone(event.target.value))}
      inputMode="tel"
      autoComplete={props.autoComplete || 'tel'}
    />
  );
}
