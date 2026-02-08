export type HierarchyLevelLabel = 'series' | 'subseries' | 'file' | 'item';

const ROMAN_TABLE: Array<{ value: number; numeral: string }> = [
  { value: 1000, numeral: 'M' },
  { value: 900, numeral: 'CM' },
  { value: 500, numeral: 'D' },
  { value: 400, numeral: 'CD' },
  { value: 100, numeral: 'C' },
  { value: 90, numeral: 'XC' },
  { value: 50, numeral: 'L' },
  { value: 40, numeral: 'XL' },
  { value: 10, numeral: 'X' },
  { value: 9, numeral: 'IX' },
  { value: 5, numeral: 'V' },
  { value: 4, numeral: 'IV' },
  { value: 1, numeral: 'I' },
];

const LEVEL_LABELS: Record<HierarchyLevelLabel, string> = {
  series: 'Series',
  subseries: 'Subseries',
  file: 'File',
  item: 'Item',
};

export function toRomanNumeral(value: number): string {
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return 'I';
  }

  let remainder = normalized;
  let result = '';
  for (const entry of ROMAN_TABLE) {
    while (remainder >= entry.value) {
      result += entry.numeral;
      remainder -= entry.value;
    }
  }

  return result || 'I';
}

export function getHierarchyLevelLabel(level: HierarchyLevelLabel): string {
  return LEVEL_LABELS[level];
}

export function formatHierarchyNodeHeading(
  level: HierarchyLevelLabel,
  numeral: string,
  title: string,
): string {
  const levelLabel = getHierarchyLevelLabel(level);
  const normalizedNumeral = numeral.trim().length > 0 ? numeral.trim() : 'I';
  const normalizedTitle = title.trim().length > 0 ? title.trim() : `Untitled ${levelLabel}`;
  return `${levelLabel} ${normalizedNumeral} - ${normalizedTitle}`;
}
