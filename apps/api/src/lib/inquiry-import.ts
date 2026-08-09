export interface InquiryImportRow {
  rowNumber: number;
  description: string;
  category: string;
  color: string;
  referenceNo: string;
  tags: string[];
  notes: string;
}

type InquiryColumn = Exclude<keyof InquiryImportRow, "rowNumber" | "tags"> | "tags";

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s_・/（）()]+/g, "");
}

function identifyColumn(header: string): InquiryColumn | null {
  const value = normalize(header);
  if (value === "description" || value.includes("落とし物の特徴") || value.includes("探し物の特徴"))
    return "description";
  if (value === "特徴" || value === "説明" || value === "詳細" || value === "聞き取り内容")
    return "description";
  if (value === "category" || value.includes("カテゴリ") || value.includes("種別"))
    return "category";
  if (value === "color" || value.includes("色")) return "color";
  if (
    value === "reference_no" ||
    value === "referenceno" ||
    value.includes("受付番号") ||
    value.includes("受付no")
  )
    return "referenceNo";
  if (value === "tags" || value.includes("タグ")) return "tags";
  if (value === "notes" || value === "メモ" || value.includes("備考")) return "notes";
  return null;
}

/** RFC 4180相当の引用符・改行・BOMを扱う、小さなCSVパーサー。 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function parseInquiryCsv(text: string): InquiryImportRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("csv_empty");
  const columns = rows[0].map(identifyColumn);
  if (!columns.includes("description")) throw new Error("description_column_required");

  return rows
    .slice(1)
    .map((cells, index) => {
      const values: Record<string, string> = {};
      columns.forEach((column, columnIndex) => {
        if (column && values[column] === undefined)
          values[column] = cells[columnIndex]?.trim() ?? "";
      });
      return {
        rowNumber: index + 2,
        description: values.description ?? "",
        category: values.category ?? "",
        color: values.color ?? "",
        referenceNo: values.referenceNo ?? "",
        tags: (values.tags ?? "")
          .split(/[、,;\n]+/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        notes: values.notes ?? "",
      };
    })
    .filter((row) =>
      [row.description, row.category, row.color, row.referenceNo, row.notes, ...row.tags].some(
        Boolean,
      ),
    );
}

export function configuredOption(value: string, options: string[]): string {
  const normalized = normalize(value);
  if (!normalized) return "";
  return options.find((option) => normalize(option) === normalized) ?? "";
}

export function inquiryImportFingerprint(referenceNo: string, description: string): string {
  return `${normalize(referenceNo)}\u0000${normalize(description)}`;
}
