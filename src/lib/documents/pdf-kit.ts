import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
export const MARGIN = 46;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

export const COLORS = {
  primary: rgb(0.02, 0.55, 0.48),
  primaryDark: rgb(0.02, 0.35, 0.31),
  ink: rgb(0.08, 0.12, 0.16),
  muted: rgb(0.38, 0.44, 0.49),
  border: rgb(0.84, 0.88, 0.9),
  soft: rgb(0.95, 0.98, 0.97),
  white: rgb(1, 1, 1),
  danger: rgb(0.7, 0.14, 0.14),
} as const;

export function safeText(value: string): string {
  return value
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u20B9/g, "Rs. ")
    .replace(/\u00A0/g, " ")
    .replace(/[^\t\n\r -~\u00A0-\u00FF]/g, "?");
}

export function formatMoney(value: number): string {
  const fixed = (Number.isFinite(value) ? value : 0).toFixed(2);
  const [whole, cents] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `Rs. ${grouped}.${cents}`;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: Date | string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateTime(
  value: Date | string | null | undefined,
  timeZone = "UTC",
): string {
  const date = toDate(value);
  if (!date) return "—";
  try {
    return date.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    });
  } catch {
    return formatDate(date);
  }
}

function splitLongWord(
  word: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const char of word) {
    const next = current + char;
    if (current && font.widthOfTextAtSize(next, size) > width) {
      pieces.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) pieces.push(current);
  return pieces;
}

export function wrapText(
  value: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const rawLine of safeText(value).split(/\r?\n/)) {
    const words = rawLine.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
      } else {
        const pieces = splitLongWord(word, font, size, maxWidth);
        lines.push(...pieces.slice(0, -1));
        current = pieces[pieces.length - 1] ?? "";
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

interface TextOptions {
  x?: number;
  width?: number;
  size?: number;
  bold?: boolean;
  color?: ReturnType<typeof rgb>;
  lineHeight?: number;
  after?: number;
  align?: "left" | "right";
}

interface TableColumn {
  header: string;
  width: number;
  align?: "left" | "right";
}

export class PdfWriter {
  page: PDFPage;
  y: number;

  constructor(
    readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
  ) {
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  addPage(): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  ensure(height: number): void {
    if (this.y - height < MARGIN + 28) this.addPage();
  }

  text(value: string, options: TextOptions = {}): number {
    const size = options.size ?? 10;
    const font = options.bold ? this.bold : this.regular;
    const x = options.x ?? MARGIN;
    const width = options.width ?? CONTENT_WIDTH;
    const lineHeight = options.lineHeight ?? size * 1.45;
    const lines = wrapText(value, font, size, width);

    this.ensure(lines.length * lineHeight);
    for (const line of lines) {
      const lineWidth = font.widthOfTextAtSize(line, size);
      this.page.drawText(line, {
        x: options.align === "right" ? x + width - lineWidth : x,
        y: this.y,
        size,
        font,
        color: options.color ?? COLORS.ink,
      });
      this.y -= lineHeight;
    }
    if (options.after) this.y -= options.after;
    return lines.length * lineHeight + (options.after ?? 0);
  }

  sectionTitle(title: string): void {
    this.ensure(34);
    this.y -= 8;
    this.page.drawRectangle({
      x: MARGIN,
      y: this.y - 2,
      width: 3,
      height: 12,
      color: COLORS.primary,
    });
    this.text(title, {
      x: MARGIN + 10,
      size: 9,
      bold: true,
      color: COLORS.primaryDark,
      lineHeight: 13,
    });
    this.y -= 2;
  }

  divider(): void {
    this.ensure(12);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.6,
      color: COLORS.border,
    });
    this.y -= 10;
  }

  table(columns: TableColumn[], rows: string[][]): void {
    const size = 8.5;
    const lineHeight = 11.5;
    const padding = 7;
    const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
    const scale = CONTENT_WIDTH / totalWidth;
    const widths = columns.map((column) => column.width * scale);

    const drawHeader = () => {
      this.ensure(24);
      this.page.drawRectangle({
        x: MARGIN,
        y: this.y - 18,
        width: CONTENT_WIDTH,
        height: 20,
        color: COLORS.soft,
      });
      let x = MARGIN + 2;
      columns.forEach((column, index) => {
        const cellWidth = widths[index] - 8;
        const lines = wrapText(column.header, this.bold, size, cellWidth);
        this.page.drawText(lines[0] ?? "", {
          x:
            column.align === "right"
              ? x + cellWidth - this.bold.widthOfTextAtSize(lines[0] ?? "", size)
              : x,
          y: this.y - 13,
          size,
          font: this.bold,
          color: COLORS.muted,
        });
        x += widths[index];
      });
      this.y -= 24;
    };

    drawHeader();

    for (const row of rows) {
      const cellLines = row.map((cell, index) =>
        wrapText(cell, this.regular, size, widths[index] - 8),
      );
      const lineCount = Math.max(1, ...cellLines.map((lines) => lines.length));
      const rowHeight = lineCount * lineHeight + padding * 2;

      if (this.y - rowHeight < MARGIN + 28) {
        this.addPage();
        drawHeader();
      }

      let x = MARGIN + 2;
      cellLines.forEach((lines, index) => {
        const cellWidth = widths[index] - 8;
        lines.forEach((line, lineIndex) => {
          this.page.drawText(line, {
            x:
              columns[index].align === "right"
                ? x +
                  cellWidth -
                  this.regular.widthOfTextAtSize(line, size)
                : x,
            y: this.y - padding - lineIndex * lineHeight,
            size,
            font: this.regular,
            color: COLORS.ink,
          });
        });
        x += widths[index];
      });

      this.y -= rowHeight;
      this.page.drawLine({
        start: { x: MARGIN, y: this.y + 1 },
        end: { x: PAGE_WIDTH - MARGIN, y: this.y + 1 },
        thickness: 0.4,
        color: COLORS.border,
      });
    }
    this.y -= 6;
  }
}

export function drawFooters(doc: PDFDocument, font: PDFFont): void {
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    page.drawLine({
      start: { x: MARGIN, y: 42 },
      end: { x: PAGE_WIDTH - MARGIN, y: 42 },
      thickness: 0.5,
      color: COLORS.border,
    });
    const text = `Computer-generated document  |  Page ${index + 1} of ${pages.length}`;
    const width = font.widthOfTextAtSize(text, 7.5);
    page.drawText(text, {
      x: (PAGE_WIDTH - width) / 2,
      y: 28,
      size: 7.5,
      font,
      color: COLORS.muted,
    });
  });
}
