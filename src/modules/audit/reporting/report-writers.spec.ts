import { ReportTable, toCsv, toPdf } from './report-writers';

const table: ReportTable = {
  title: 'Test report',
  generatedAt: '2024-01-01T00:00:00.000Z',
  columns: ['action', 'note'],
  rows: [
    ['user.login', 'ok'],
    ['trade.execute', 'has, comma'],
    ['note.add', 'has "quote"'],
    ['multi.line', 'line1\nline2'],
  ],
};

describe('toCsv', () => {
  it('emits a header row then one row per record', () => {
    const csv = toCsv(table);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('action,note');
    expect(lines).toHaveLength(5);
  });

  it('quotes fields containing commas, quotes, or newlines (RFC 4180)', () => {
    const csv = toCsv(table);
    expect(csv).toContain('"has, comma"');
    expect(csv).toContain('"has ""quote"""');
    expect(csv).toContain('"line1\nline2"');
  });
});

describe('toPdf', () => {
  it('produces a valid PDF buffer with header, xref and EOF marker', () => {
    const pdf = toPdf(table);
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('xref');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('escapes PDF-special characters in content', () => {
    const pdf = toPdf({
      ...table,
      rows: [['weird', 'a(b)c\\d']],
    });
    const text = pdf.toString('latin1');
    expect(text).toContain('a\\(b\\)c\\\\d');
  });

  it('handles an empty result set without throwing', () => {
    expect(() => toPdf({ ...table, rows: [] })).not.toThrow();
  });
});
