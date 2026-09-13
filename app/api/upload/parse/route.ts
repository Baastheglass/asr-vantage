import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { requireRole } from '@/lib/auth';
import { handler, ok, bad } from '@/lib/api';
import { parseWorkbook, detectMapping, validateRows, FIELDS, type Mapping } from '@/lib/import';
import { db, audit } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UPLOAD_DIR = path.join(process.cwd(), 'data', 'uploads');

export const POST = handler(async (req: NextRequest) => {
  const user = await requireRole('REWARDS', 'ADMIN');

  const form = await req.formData();
  const file = form.get('file');
  const mappingOverride = form.get('mapping');
  const token = String(form.get('token') ?? '');

  let rows: Record<string, any>[];
  let headers: string[];
  let fileName: string;

  if (token) {
    // Re-validate an already-uploaded file under a corrected mapping.
    const p = path.join(UPLOAD_DIR, `${path.basename(token)}.json`);
    if (!fs.existsSync(p)) return bad('Upload session expired — please upload the file again.', 410);
    const cached = JSON.parse(fs.readFileSync(p, 'utf8'));
    rows = cached.rows; headers = cached.headers; fileName = cached.fileName;
  } else {
    if (!(file instanceof File)) return bad('No file was uploaded');
    if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) {
      return bad('Please upload an Excel workbook (.xlsx, .xlsm, .xls) or a .csv file');
    }
    if (file.size > 25 * 1024 * 1024) return bad('File is larger than 25 MB');

    const buf = Buffer.from(await file.arrayBuffer());
    const parsed = parseWorkbook(buf);
    rows = parsed.rows; headers = parsed.headers; fileName = file.name;

    if (rows.length === 0) return bad('No data rows were found in the workbook');
  }

  const mapping: Mapping = mappingOverride
    ? JSON.parse(String(mappingOverride))
    : (() => {
        // Prefer the mapping saved from the last successful import.
        const saved = db.prepare(`SELECT mapping FROM column_mappings ORDER BY id DESC LIMIT 1`).get() as { mapping: string } | undefined;
        if (saved) {
          const m = JSON.parse(saved.mapping) as Mapping;
          const stillValid = Object.values(m).every((h) => !h || headers.includes(h as string));
          const covers = FIELDS.filter((f) => f.required).every((f) => m[f.key] && headers.includes(m[f.key]!));
          if (stillValid && covers) return m;
        }
        return detectMapping(headers);
      })();

  const report = validateRows(rows, mapping);

  const newToken = token || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(UPLOAD_DIR, `${newToken}.json`),
    JSON.stringify({ rows, headers, fileName }),
  );

  if (!token) {
    audit({ actor: user, action: 'FILE_UPLOADED', entity: 'upload', entityId: newToken,
      meta: { fileName, rows: rows.length } });
  }

  return ok({
    token: newToken,
    fileName,
    headers,
    mapping,
    fields: FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required })),
    sample: rows.slice(0, 5),
    ...report,
    issues: report.issues.slice(0, 500),
    issuesTruncated: report.issues.length > 500,
  });
});
