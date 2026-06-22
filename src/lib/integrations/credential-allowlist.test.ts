import test from 'node:test';
import assert from 'node:assert/strict';

import { isOperationAllowed, allowedOperations } from './credential-allowlist';
import { requireCredentialPermission, CredentialPermissionError } from './credential-scope';

test('allowlisted Zoho operations pass', () => {
  assert.equal(isOperationAllowed('zoho', 'purchaseorders.read'), true);
  assert.equal(isOperationAllowed('zoho', 'invoices.write'), true);
});

test('non-allowlisted Zoho operation is denied (deny-by-default)', () => {
  // Not in the declared set — must be rejected even though it's a plausible op.
  assert.equal(isOperationAllowed('zoho', 'contacts.write' as never), false);
});

test('a provider with no declared operations denies everything', () => {
  assert.equal(allowedOperations('square').size, 0);
  assert.equal(isOperationAllowed('square', 'payments.read' as never), false);
});

test('requireCredentialPermission throws CredentialPermissionError when denied', () => {
  assert.throws(
    () => requireCredentialPermission('zoho', 'contacts.write' as never),
    (err: unknown) => err instanceof CredentialPermissionError && err.code === 'CREDENTIAL_OPERATION_NOT_ALLOWED',
  );
});

test('requireCredentialPermission is a no-op for allowed operations', () => {
  assert.doesNotThrow(() => requireCredentialPermission('zoho', 'purchaseorders.read'));
});
