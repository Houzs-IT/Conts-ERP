/* Spread into the options of a jsPDF that is handed to a customer. jsPDF writes page content streams
   uncompressed unless told otherwise, so a text-and-table document was several times larger than it
   needed to be — on the phone and on WhatsApp. Ported from Houzs ERP (#5552); the official receipt,
   the sales invoice and the deposit invoice use it (pdf-options.test.ts). */
export const PDF_COMPRESS = { compress: true } as const;
