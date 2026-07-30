import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { currencyFractionDigits, minorToMajor } from "@/domain/billing/money";
import type { ReportRow } from "@/domain/reports/reporting";

export interface PdfOptions {
  title: string;
  companyName: string;
  clientName: string;
  clientAddress?: string | null;
  dateRange: string;
  timezone: string;
  reference?: string;
  notes?: string;
  showMembers: boolean;
  showDescriptions: boolean;
  showTags: boolean;
  showRates: boolean;
  grouping: "project" | "date";
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const PRIMARY_GREEN = rgb(52 / 255, 83 / 255, 19 / 255);
const ACCENT_GREEN = rgb(33 / 255, 222 / 255, 71 / 255);
const TEXT_GREEN = rgb(18 / 255, 29 / 255, 7 / 255);
const TINT_GREEN = rgb(243 / 255, 250 / 255, 234 / 255);

function safePdfText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\s+/g, " ")
    .trim();
}

function durationLabel(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

function drawHeader(
  page: PDFPage,
  bold: PDFFont,
  regular: PDFFont,
  options: PdfOptions,
  pageNumber: number,
) {
  page.drawText(safePdfText(options.companyName), {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN,
    font: bold,
    size: 11,
    color: PRIMARY_GREEN,
  });
  page.drawText(safePdfText(options.title), {
    x: MARGIN,
    y: PAGE_HEIGHT - MARGIN - 28,
    font: bold,
    size: 24,
    color: TEXT_GREEN,
  });
  page.drawText(`Page ${pageNumber}`, {
    x: PAGE_WIDTH - MARGIN - 42,
    y: 24,
    font: regular,
    size: 8,
    color: rgb(0.4, 0.45, 0.46),
  });
}

export async function createTimeReportPdf(
  rows: ReportRow[],
  options: PdfOptions,
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let pageNumber = 1;
  let page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(page, bold, regular, options, pageNumber);
  let y = PAGE_HEIGHT - 115;

  const addPage = () => {
    pageNumber += 1;
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawHeader(page, bold, regular, options, pageNumber);
    y = PAGE_HEIGHT - 82;
  };
  const ensureSpace = (height: number) => {
    if (y - height < 48) addPage();
  };
  const write = (text: string, x: number, size = 9, font = regular, color = TEXT_GREEN) => {
    page.drawText(safePdfText(text).slice(0, 105), { x, y, size, font, color });
  };

  write(`Client: ${options.clientName}`, MARGIN, 11, bold);
  y -= 16;
  if (options.clientAddress) {
    write(options.clientAddress, MARGIN, 9);
    y -= 14;
  }
  write(`Period: ${options.dateRange} (${options.timezone})`, MARGIN);
  y -= 14;
  if (options.reference) {
    write(`Reference: ${options.reference}`, MARGIN);
    y -= 14;
  }
  if (options.notes) {
    write(`Notes: ${options.notes}`, MARGIN);
    y -= 18;
  }

  const grouped = new Map<string, ReportRow[]>();
  for (const row of rows) {
    const key = options.grouping === "project" ? row.projectName : row.date;
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  const totalsByCurrency: Record<string, number> = {};
  let totalDuration = 0;
  for (const [groupLabel, groupRows] of grouped) {
    ensureSpace(48);
    y -= 8;
    page.drawRectangle({
      x: MARGIN,
      y: y - 5,
      width: PAGE_WIDTH - MARGIN * 2,
      height: 22,
      color: TINT_GREEN,
    });
    write(groupLabel, MARGIN + 8, 10, bold);
    write("Duration", PAGE_WIDTH - MARGIN - 58, 9, bold);
    y -= 25;

    for (const row of groupRows) {
      ensureSpace(options.showDescriptions || options.showTags ? 34 : 20);
      const label = [
        options.showMembers ? row.memberName : null,
        options.grouping === "date" ? row.projectName : row.date,
      ]
        .filter(Boolean)
        .join(" · ");
      write(label, MARGIN + 8, 8, bold);
      write(durationLabel(row.roundedDurationMs), PAGE_WIDTH - MARGIN - 54, 9, bold);
      y -= 13;
      if (options.showDescriptions) {
        write(row.description, MARGIN + 18, 8);
        y -= 12;
      }
      if (options.showTags && row.tags.length > 0) {
        write(`Tags: ${row.tags.map((tag) => tag.name).join(", ")}`, MARGIN + 18, 7);
        y -= 11;
      }
      if (options.showRates && row.currency && row.rateMinor !== null) {
        write(
          `${row.currency} ${minorToMajor(row.rateMinor, row.currency).toFixed(
            currencyFractionDigits(row.currency),
          )}/hour · amount ${minorToMajor(row.amountMinor ?? 0, row.currency).toFixed(
            currencyFractionDigits(row.currency),
          )}`,
          MARGIN + 18,
          7,
        );
        y -= 11;
      }
      totalDuration += row.roundedDurationMs;
      if (row.currency && row.amountMinor !== null) {
        totalsByCurrency[row.currency] = (totalsByCurrency[row.currency] ?? 0) + row.amountMinor;
      }
    }
  }

  ensureSpace(60);
  y -= 14;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 1,
    color: ACCENT_GREEN,
  });
  y -= 20;
  write(`Total time: ${durationLabel(totalDuration)}`, MARGIN, 12, bold);
  if (options.showRates) {
    let amountY = y;
    for (const [currency, amount] of Object.entries(totalsByCurrency)) {
      page.drawText(
        `${currency} ${minorToMajor(amount, currency).toFixed(currencyFractionDigits(currency))}`,
        {
          x: PAGE_WIDTH - MARGIN - 100,
          y: amountY,
          size: 10,
          font: bold,
          color: PRIMARY_GREEN,
        },
      );
      amountY -= 14;
    }
  }
  y -= 32;
  write("Time report only. Amounts exclude taxes and do not constitute an invoice.", MARGIN, 7);

  return document.save();
}
