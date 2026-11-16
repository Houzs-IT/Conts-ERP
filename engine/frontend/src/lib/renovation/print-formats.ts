/* The five print formats of a renovation document (quotation, sales order,
   variation order). One document, the format is chosen at print time.
   Column sets follow the owner's sample PDFs:
     AMOUNT          AVA Residence (Dream Crafter): Unit Price header printed, column empty
                     except a measured line's rate ("15/FT"); page totals; GRAND TOTAL.
     UNIT_PRICE      D'Clover wiring pages: unit price and amount.
     DISCOUNT        D'Clover carpentry pages: DISC PRICE (the discounted amount) and the
                     discount %, Amount at list; a small net subtotal above each page's
                     list TOTAL; last page TOTAL -> DISCOUNT -> FINAL TOTAL.
     QTY_ONLY        Skyline Embassy package (The Conts): no prices, one package total.
     PROMO_STANDARD  KL 48 amenities: Promotion (unit price) and Standard price, total at promotion. */

export type PrintFormat = 'AMOUNT' | 'UNIT_PRICE' | 'DISCOUNT' | 'QTY_ONLY' | 'PROMO_STANDARD';

export type ColumnKey = 'no' | 'desc' | 'qty' | 'unit' | 'discPrice' | 'disc' | 'promo' | 'standard' | 'amount';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  /** Width in mm on an A4 page with 14 mm margins (182 mm usable). */
  width: number;
  align: 'left' | 'center' | 'right';
}

export interface FormatDef {
  format: PrintFormat;
  label: string;
  hint: string;
  columns: ColumnDef[];
  /** What the per-page TOTAL box sums: net (charged), list, or nothing. */
  pageTotal: 'net' | 'list' | 'none';
  /** Small net subtotal printed above a list page total (format 3). */
  netSubtotal: boolean;
}

const no: ColumnDef = { key: 'no', label: 'No', width: 10, align: 'center' };
const qty: ColumnDef = { key: 'qty', label: 'Qty', width: 18, align: 'center' };
const amount: ColumnDef = { key: 'amount', label: 'Amount (RM)', width: 29, align: 'right' };

export const PRINT_FORMATS: Record<PrintFormat, FormatDef> = {
  AMOUNT: {
    format: 'AMOUNT', label: 'Amount only', hint: 'No, description, qty and amount, with page totals',
    columns: [no, { key: 'desc', label: 'Item Description', width: 103, align: 'left' }, qty,
      { key: 'unit', label: 'Unit Price', width: 22, align: 'center' }, amount],
    pageTotal: 'net', netSubtotal: false,
  },
  UNIT_PRICE: {
    format: 'UNIT_PRICE', label: 'Unit price', hint: 'Unit price and amount on every line',
    columns: [no, { key: 'desc', label: 'Item Description', width: 103, align: 'left' }, qty,
      { key: 'unit', label: 'Unit Price', width: 22, align: 'right' }, amount],
    pageTotal: 'net', netSubtotal: false,
  },
  DISCOUNT: {
    format: 'DISCOUNT', label: 'Discount detail', hint: 'Disc price and disc %, amount at list; total, discount, final total',
    columns: [no, { key: 'desc', label: 'Item Description', width: 83, align: 'left' }, qty,
      { key: 'discPrice', label: 'Disc Price (RM)', width: 29, align: 'right' }, { key: 'disc', label: '', width: 13, align: 'center' }, amount],
    pageTotal: 'list', netSubtotal: true,
  },
  QTY_ONLY: {
    format: 'QTY_ONLY', label: 'Qty only', hint: 'No prices; one package total on the last page',
    columns: [no, { key: 'desc', label: 'Item Description', width: 154, align: 'left' }, qty],
    pageTotal: 'none', netSubtotal: false,
  },
  PROMO_STANDARD: {
    format: 'PROMO_STANDARD', label: 'Promotion vs standard', hint: 'Promotion and standard price columns, total at promotion',
    columns: [no, { key: 'desc', label: 'Item Description', width: 108, align: 'left' }, { key: 'promo', label: 'Promotion', width: 22, align: 'right' },
      { key: 'standard', label: 'Standard', width: 22, align: 'right' }, { ...qty, width: 20 }],
    pageTotal: 'net', netSubtotal: false,
  },
};

export const PRINT_FORMAT_LIST: PrintFormat[] = ['AMOUNT', 'UNIT_PRICE', 'DISCOUNT', 'QTY_ONLY', 'PROMO_STANDARD'];

export function isPrintFormat(x: unknown): x is PrintFormat {
  return typeof x === 'string' && (PRINT_FORMAT_LIST as string[]).includes(x);
}
