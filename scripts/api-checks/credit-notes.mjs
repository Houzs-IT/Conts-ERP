// Credit / debit notes, copied from Houzs ERP. A draft changes no balance; posting a credit note
// lowers what the customer (CN) or we (SCN) owe, a debit note (DN) raises it; cancelling a posted
// note undoes its effect; a posted note can't be edited; posting twice is harmless.
import { call, check, done } from './harness.mjs';
const tag = Date.now().toString().slice(-6);
await call('POST', '/api/products', { code: `CNI-${tag}`, name: `CN item ${tag}`, category: 'ACCESSORY' }); // documents only take Products codes
const ap = async (code) => ((await call('GET', '/api/accounting')).json?.payables ?? []).find(p => p.code === code)?.outstandingSen ?? 0;
const ar = async (name) => ((await call('GET', '/api/accounting')).json?.receivables ?? []).find(p => p.name === name)?.outstandingSen ?? 0;

// --- a supplier invoice worth RM 200 ---
let r = await call('POST', '/api/suppliers', { code: `SC${tag}`, name: `CN Supplier ${tag}` }); const SUP = r.json?.id;
r = await call('POST', '/api/purchase-orders', { supplierId: SUP, lines: [{ itemCode: `CNI-${tag}`, description: 'CN item', qty: 2, unitPriceSen: 10000 }] }); const PO = r.json?.id;
const poLine = (await call('GET', `/api/purchase-orders/${PO}`)).json?.data?.lines?.[0];
r = await call('POST', '/api/goods-receipts', { purchaseOrderId: PO, lines: [{ purchaseOrderLineId: poLine?.id, itemCode: `CNI-${tag}`, description: 'CN item', qtyReceived: 2, qtyAccepted: 2, unitPriceSen: 10000 }] }); const GRN = r.json?.id;
const grnLine = (await call('GET', `/api/goods-receipts/${GRN}`)).json?.data?.lines?.[0];
r = await call('POST', '/api/purchase-invoices', { grnId: GRN, supplierId: SUP, lines: [{ grnLineId: grnLine?.id, itemCode: `CNI-${tag}`, description: 'CN item', qty: 2, unitPriceSen: 10000 }] }); const PI = r.json?.id;
check('supplier invoice raised, owed RM 200', r.status === 201 && await ap(`SC${tag}`) === 20000, `${r.text} ap=${await ap(`SC${tag}`)}`);

// --- supplier credit note: draft does nothing, post lowers, cancel restores ---
r = await call('POST', '/api/credit-notes', { kind: 'SCN', supplierId: SUP, purchaseInvoiceId: PI, reason: 'Goods returned', lines: [{ description: 'Returned 1', amountSen: 3000 }, { description: 'Freight', amountSen: 500 }] });
const SCN = r.json?.id;
check('SCN raised as draft with its own series', r.status === 201 && /^SCN-\d{4}-\d{4}$/.test(r.json?.noteNumber ?? ''), r.text);
check('draft SCN leaves payable at RM 200', await ap(`SC${tag}`) === 20000, await ap(`SC${tag}`));
r = await call('PATCH', `/api/credit-notes/${SCN}`, { lines: [{ description: 'Returned 1', amountSen: 3000 }] });
check('a draft can be edited (total now RM 30)', r.status === 200 && (await call('GET', `/api/credit-notes/${SCN}`)).json?.data?.totalSen === 3000, r.text);
r = await call('PATCH', `/api/credit-notes/${SCN}`, { status: 'POSTED' });
check('post SCN', r.status === 200, r.text);
check('posted SCN lowers payable to RM 170', await ap(`SC${tag}`) === 17000, await ap(`SC${tag}`));
r = await call('PATCH', `/api/credit-notes/${SCN}`, { status: 'POSTED' });
check('posting again is harmless (still RM 170)', r.status === 200 && await ap(`SC${tag}`) === 17000, r.text);
r = await call('PATCH', `/api/credit-notes/${SCN}`, { reason: 'changed' });
check('posted note cannot be edited (409)', r.status === 409, r.text);
r = await call('PATCH', `/api/credit-notes/${SCN}`, { status: 'CANCELLED' });
check('cancelled SCN restores payable to RM 200', r.status === 200 && await ap(`SC${tag}`) === 20000, await ap(`SC${tag}`));
r = await call('PATCH', `/api/credit-notes/${SCN}`, { status: 'POSTED' });
check('a cancelled note cannot be posted (409)', r.status === 409, r.text);

// --- customer side: a sales invoice worth RM 500 ---
const CUST = `CN Customer ${tag}`;
r = await call('POST', '/api/sales-orders', { customerName: CUST, lines: [{ itemCode: `CNI-${tag}`, description: 'CN item', qty: 1, unitPriceSen: 50000 }] }); const SO = r.json?.id;
const soLine = (await call('GET', `/api/sales-orders/${SO}`)).json?.data?.lines?.[0];
r = await call('POST', '/api/delivery-orders', { salesOrderId: SO, lines: [{ salesOrderLineId: soLine?.id, itemCode: `CNI-${tag}`, description: 'CN item', qty: 1, unitPriceSen: 50000 }] }); const DO = r.json?.id;
r = await call('POST', '/api/sales-invoices', { deliveryOrderId: DO }); const SI = r.json?.id;
check('customer invoice raised, owes RM 500', r.status === 201 && await ar(CUST) === 50000, `${r.text} ar=${await ar(CUST)}`);

r = await call('POST', '/api/credit-notes', { kind: 'CN', salesInvoiceId: SI, lines: [{ description: 'Price correction', amountSen: 8000 }] }); const CN = r.json?.id;
check('CN takes the customer from the invoice', r.status === 201 && (await call('GET', `/api/credit-notes/${CN}`)).json?.data?.partyName === CUST, r.text);
await call('PATCH', `/api/credit-notes/${CN}`, { status: 'POSTED' });
check('posted CN lowers receivable to RM 420', await ar(CUST) === 42000, await ar(CUST));
r = await call('POST', '/api/credit-notes', { kind: 'DN', salesOrderId: SO, lines: [{ description: 'Undercharged delivery', amountSen: 2000 }] }); const DN = r.json?.id;
await call('PATCH', `/api/credit-notes/${DN}`, { status: 'POSTED' });
check('posted DN raises receivable to RM 440', await ar(CUST) === 44000, await ar(CUST));
// A credit note may exceed what the invoice still owes (owner, 11 Oct 2026): RM 600 against RM 440 owing.
r = await call('POST', '/api/credit-notes', { kind: 'CN', salesInvoiceId: SI, lines: [{ description: 'Full refund plus goodwill', amountSen: 60000 }] });
check('a CN larger than the invoice balance is accepted', r.status === 201, r.text);
await call('PATCH', `/api/credit-notes/${r.json?.id}`, { status: 'POSTED' });
check('posted, it leaves the customer in credit (-RM 160)', await ar(CUST) === -16000, await ar(CUST));

// --- a typed customer with no invoice goes into credit ---
const LONE = `Lone Customer ${tag}`;
r = await call('POST', '/api/credit-notes', { kind: 'CN', partyName: LONE, lines: [{ description: 'Goodwill', amountSen: 1500 }] });
await call('PATCH', `/api/credit-notes/${r.json?.id}`, { status: 'POSTED' });
check('typed customer with only a CN shows in credit (-RM 15)', await ar(LONE) === -1500, await ar(LONE));

// --- refusals ---
r = await call('POST', '/api/credit-notes', { kind: 'XX', partyName: 'x', lines: [{ amountSen: 100 }] }); check('unknown kind refused (422)', r.status === 422, r.text);
r = await call('POST', '/api/credit-notes', { kind: 'CN', partyName: 'x', lines: [] }); check('no lines refused (422)', r.status === 422, r.text);
r = await call('POST', '/api/credit-notes', { kind: 'CN', partyName: 'x', lines: [{ amountSen: 0 }] }); check('zero amount refused (422)', r.status === 422, r.text);
r = await call('POST', '/api/credit-notes', { kind: 'CN', lines: [{ amountSen: 100 }] }); check('customer note with nobody named refused (422)', r.status === 422, r.text);
r = await call('POST', '/api/credit-notes', { kind: 'SCN', lines: [{ amountSen: 100 }] }); check('supplier note with no supplier refused (422)', r.status === 422, r.text);
r = await call('POST', '/api/suppliers', { code: `SO${tag}`, name: `Other Supplier ${tag}` });
r = await call('POST', '/api/credit-notes', { kind: 'SCN', supplierId: r.json?.id, purchaseInvoiceId: PI, lines: [{ amountSen: 100 }] });
check("another supplier's invoice refused (422)", r.status === 422, r.text);
r = await call('GET', '/api/credit-notes', undefined, 'housekeeper'); check('housekeeper cannot list notes (403)', r.status === 403, r.text);
r = await call('POST', '/api/credit-notes', { kind: 'CN', partyName: 'x', lines: [{ amountSen: 100 }] }, 'housekeeper'); check('housekeeper cannot raise notes (403)', r.status === 403, r.text);

// --- consignment notes number under CSN-, never CN- (owner, 11 Oct 2026) ---
r = await call('POST', '/api/credit-notes', { kind: 'CN', partyName: `Series ${tag}`, lines: [{ description: 'Series check', amountSen: 100 }] });
check('a credit note numbers under CN-', r.status === 201 && /^CN-\d{4}-\d{4}$/.test(r.json?.noteNumber ?? ''), r.text);
r = await call('POST', '/api/consignment-notes', { consigneeName: `Showroom ${tag}`, lines: [{ itemCode: `CNI-${tag}`, description: 'CN item', qtyConsigned: 1, unitPriceSen: 100 }] });
check('a consignment note numbers under CSN-, so the two never share a prefix', r.status === 201 && /^CSN-\d{4}-\d{4}$/.test(r.json?.cnNumber ?? ''), r.text);

done();
