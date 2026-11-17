// node --test src/lib/claimBank.test.mjs. The bank a Direct Claim to Me is paid to (chew, 12 Nov 2026): the engine's
// rules (engine/backend/src/conts/my-claims-routes.ts claimBank), checked first on the forms and in the job's documents
// route, so a person hears which field is wrong before anything is sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { bankProblem } = await import('./claimBank.ts');

const OK = { bankName: 'Maybank', accountNo: '1234567890', accountName: 'AH WAI' };

test('a whole bank is fine; spaces and dashes in the account number are dropped', () => {
  assert.equal(bankProblem(OK), null);
  assert.equal(bankProblem({ ...OK, accountNo: '1234-5678 90' }), null);
  assert.equal(bankProblem({ ...OK, accountNo: '12345' }), null);
  assert.equal(bankProblem({ ...OK, accountNo: '1'.repeat(30) }), null);
});

test('names the first field that is wrong, in the order of the form', () => {
  assert.equal(bankProblem(null), 'bankName');
  assert.equal(bankProblem({}), 'bankName');
  assert.equal(bankProblem({ ...OK, bankName: ' ' }), 'bankName');
  assert.equal(bankProblem({ ...OK, bankName: 'B'.repeat(61) }), 'bankName');
  assert.equal(bankProblem({ ...OK, accountNo: '' }), 'accountNo');
  assert.equal(bankProblem({ ...OK, accountNo: '12AB5678' }), 'accountNo');
  assert.equal(bankProblem({ ...OK, accountNo: '1234' }), 'accountNo');
  assert.equal(bankProblem({ ...OK, accountNo: '1'.repeat(31) }), 'accountNo');
  assert.equal(bankProblem({ ...OK, accountName: '' }), 'accountName');
  assert.equal(bankProblem({ ...OK, accountName: 'A'.repeat(101) }), 'accountName');
  assert.equal(bankProblem({ bankName: '', accountNo: 'x', accountName: '' }), 'bankName');
});
