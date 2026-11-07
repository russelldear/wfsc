/**
 * Builds RFC 4180 CSV. Cells that start with "=" or "@" are prefixed with an
 * apostrophe so spreadsheets treat them as text, not formulas. "+" and "-"
 * are left alone because phone numbers (+64...) start with them.
 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

function cell(value: string): string {
  let v = value;
  if (/^[=@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Triggers a browser download. The BOM helps Excel read macrons (Māori). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
