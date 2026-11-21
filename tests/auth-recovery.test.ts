import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deriveRecoveryStateFromAuthEvent,
  getAuthRedirectOrigin,
  isEmailNotConfirmedError,
  isValidAuthEmail,
  performPasswordRecoveryUpdate,
  validateNewPassword,
} from '../src/utils/authHelpers';

test('deriveRecoveryStateFromAuthEvent enters on PASSWORD_RECOVERY and clears on sign-out or empty session', () => {
  assert.equal(deriveRecoveryStateFromAuthEvent('INITIAL_SESSION', false, false), false);
  assert.equal(deriveRecoveryStateFromAuthEvent('PASSWORD_RECOVERY', true, false), true);
  assert.equal(deriveRecoveryStateFromAuthEvent('TOKEN_REFRESHED', true, true), true);
  assert.equal(deriveRecoveryStateFromAuthEvent('SIGNED_OUT', false, true), false);
  assert.equal(deriveRecoveryStateFromAuthEvent('TOKEN_REFRESHED', false, true), false);
});

test('validateNewPassword enforces minimum length and matching confirmation', () => {
  assert.equal(validateNewPassword('', ''), 'Please enter a new password.');
  assert.equal(
    validateNewPassword('12345', '12345'),
    'Password must be at least 6 characters.',
  );
  assert.equal(
    validateNewPassword('secret123', 'secret124'),
    'Passwords do not match.',
  );
  assert.equal(validateNewPassword('secret123', 'secret123'), null);
});

test('getAuthRedirectOrigin resolves valid browser http/https origins safely', () => {
  assert.equal(getAuthRedirectOrigin('https://klyvo.app/reset?token=abc'), 'https://klyvo.app');
  assert.equal(getAuthRedirectOrigin('http://localhost:3000/auth'), 'http://localhost:3000');
  assert.equal(getAuthRedirectOrigin('null'), undefined);
  assert.equal(getAuthRedirectOrigin('javascript:alert(1)'), undefined);
  assert.equal(getAuthRedirectOrigin(''), undefined);
  assert.equal(getAuthRedirectOrigin(), undefined);
});

test('performPasswordRecoveryUpdate validates inputs, calls updateUser, and clears recovery only on success', async () => {
  let updateCalls = 0;
  let recoveryActive = true;

  // Validation error prevents updateUser call and preserves recovery state
  const shortResult = await performPasswordRecoveryUpdate({
    newPassword: 'abc',
    confirmPassword: 'abc',
    updateUser: async () => {
      updateCalls += 1;
      return { error: null };
    },
    onSuccessClearRecovery: () => {
      recoveryActive = false;
    },
  });
  assert.equal(shortResult.error, 'Password must be at least 6 characters.');
  assert.equal(updateCalls, 0);
  assert.equal(recoveryActive, true);

  // Supabase error returns error and keeps recovery active for retry
  const failedUpdate = await performPasswordRecoveryUpdate({
    newPassword: 'new-password-1',
    confirmPassword: 'new-password-1',
    updateUser: async () => {
      updateCalls += 1;
      return { error: { message: 'New password should be different from the old password.' } };
    },
    onSuccessClearRecovery: () => {
      recoveryActive = false;
    },
  });
  assert.equal(
    failedUpdate.error,
    'New password should be different from the old password.',
  );
  assert.equal(updateCalls, 1);
  assert.equal(recoveryActive, true);

  // Valid password update calls updateUser with new password and clears recovery state
  let updatedWith: string | null = null;
  const successUpdate = await performPasswordRecoveryUpdate({
    newPassword: 'new-password-2',
    confirmPassword: 'new-password-2',
    updateUser: async ({ password }) => {
      updateCalls += 1;
      updatedWith = password;
      return { error: null };
    },
    onSuccessClearRecovery: () => {
      recoveryActive = false;
    },
  });
  assert.equal(successUpdate.error, null);
  assert.equal(updateCalls, 2);
  assert.equal(updatedWith, 'new-password-2');
  assert.equal(recoveryActive, false);
});

test('isEmailNotConfirmedError and isValidAuthEmail classify common auth inputs', () => {
  assert.equal(isValidAuthEmail('user@klyscape.com'), true);
  assert.equal(isValidAuthEmail('invalid-email'), false);
  assert.equal(isEmailNotConfirmedError('Email not confirmed'), true);
  assert.equal(isEmailNotConfirmedError('Invalid login credentials'), false);
  assert.equal(isEmailNotConfirmedError(null), false);
});
