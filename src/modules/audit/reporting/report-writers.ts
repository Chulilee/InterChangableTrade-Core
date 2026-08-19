/**
 * Dependency-free serializers for compliance reports. The service turns audit
 * rows into a table of `columns` + `rows`, and these functions render that
 * table to the requested wire format. Keeping this self-contained avoids adding
 * a heavyweight PDF/CSV dependency to the build.
 */

export interface ReportTable {
  title: string;
  generatedAt: string;
  columns: string[];
  rows: string[][];
}

/** Escape a single CSV field per RFC 4180 (quote if it contains `,` `"` or a newline). */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Render a {@link ReportTable} as RFC 4180 CSV text. */
export function toCsv(table: ReportTable): string {
  const lines = [table.columns.map(csvField).join(',')];
  for (const row of table.rows) {
    lines.push(row.map((cell) => csvField(cell ?? '')).join(','));
  }
  return lines.join('\r\n');
}

/** Escape the three characters that are special inside a PDF text string. */
function pdfText(value: string): string {
  return value.replace(/([\\()])/g, '\\$1');
}

/**
 * Render a {@link ReportTable} as a minimal, valid multi-page PDF (Helvetica,
 * one logical table row per line). This hand-builds the PDF object graph and
 * xref table so no external library is required; the output opens in any
 * conformant reader.
 */
export function toPdf(table: ReportTable): Buffer {
  const linesPerPage = 50;
  const fontSize = 9;
  const leading = 12;
  const left = 40;
  const top = 800;

  // Flatten the table into printable text lines.
  const textLines: string[] = [
    table.title,
    `Generated: ${table.generatedAt}`,
    '',
  ];
  textLines.push(table.columns.join(' | '));
  textLines.push('-'.repeat(Math.min(120, table.columns.join(' | ').length)));
  for (const row of table.rows) {
    textLines.push(row.map((c) => (c ?? '').replace(/\s+/g, ' ')).join(' | '));
  }

  // Chunk into pages.
  const pages: string[][] = [];
  for (let i = 0; i < textLines.length; i += linesPerPage) {
    pages.push(textLines.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) {
    pages.push(['(no records)']);
  }

  const objects: string[] = [];
  // Object numbering: 1 = Catalog, 2 = Pages, 3 = Font, then per page a Page
  // object and a Content object.
  const pageObjNums: number[] = [];
  const contentObjNums: number[] = [];
  let nextObj = 4;
  for (let i = 0; i < pages.length; i++) {
    pageObjNums.push(nextObj++);
    contentObjNums.push(nextObj++);
  }

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageObjNums
    .map((n) => `${n} 0 R`)
    .join(' ')}] /Count ${pages.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  pages.forEach((pageLines, i) => {
    const pageNum = pageObjNums[i];
    const contentNum = contentObjNums[i];
    objects[pageNum] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`;

    let stream = `BT /F1 ${fontSize} Tf ${leading} TL ${left} ${top} Td\n`;
    pageLines.forEach((line, idx) => {
      const escaped = pdfText(line);
      stream += idx === 0 ? `(${escaped}) Tj\n` : `T* (${escaped}) Tj\n`;
    });
    stream += 'ET';
    objects[contentNum] =
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  // Assemble the file with a byte-accurate xref table.
  const header = '%PDF-1.4\n';
  let body = '';
  const offsets: number[] = [];
  const totalObjs = nextObj - 1;
  for (let n = 1; n <= totalObjs; n++) {
    offsets[n] = Buffer.byteLength(header + body, 'latin1');
    body += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }

  const xrefStart = Buffer.byteLength(header + body, 'latin1');
  let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= totalObjs; n++) {
    xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(header + body + xref + trailer, 'latin1');
}
