export function normalizeTrueFalseValue(value: string): 'TRUE' | 'FALSE' | null {
  const normalized = value.trim().toUpperCase();

  if (normalized === 'V' || normalized === 'VERDADERO' || normalized === 'TRUE') {
    return 'TRUE';
  }

  if (normalized === 'F' || normalized === 'FALSO' || normalized === 'FALSE') {
    return 'FALSE';
  }

  return null;
}
