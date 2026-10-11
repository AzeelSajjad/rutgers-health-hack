import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, '../../auth0-actions/pre-user-registration.js'), 'utf8');
const actionExports: { onExecutePreUserRegistration?: (event: unknown, api: unknown) => Promise<void> } = {};
runInNewContext(source, { exports: actionExports });
const base = () => ({ secrets: { SCHOOL_EMAIL_DOMAINS: 'school.edu' }, user: { email: 'Student@School.edu', username: 'student123' }, request: { body: { 'ulp-first-name': '  Alex ', 'ulp-last-name': ' Learner ' } } });
const api = () => ({ access: { deny: vi.fn() }, validation: { error: vi.fn() }, user: { setUserMetadata: vi.fn() } });

describe('hosted signup validation', () => {
  it.each([null, 42, {}, ['Alex']])('rejects malformed name values without throwing (%j)', async name => {
    const event = base();
    event.request.body['ulp-first-name'] = name as never;
    const hooks = api();
    await expect(actionExports.onExecutePreUserRegistration!(event, hooks)).resolves.toBeUndefined();
    expect(hooks.validation.error).toHaveBeenCalled();
    expect(hooks.user.setUserMetadata).not.toHaveBeenCalled();
  });
  it.each(['x'.repeat(121), '\u0000Alex', '  '])('rejects oversized, control-character or blank names', async name => {
    const event = base();
    event.request.body['ulp-last-name'] = name;
    const hooks = api();
    await actionExports.onExecutePreUserRegistration!(event, hooks);
    expect(hooks.validation.error).toHaveBeenCalled();
  });
  it('handles a missing request body and invalid username safely', async () => {
    const hooks = api();
    await expect(actionExports.onExecutePreUserRegistration!({ ...base(), request: {} }, hooks)).resolves.toBeUndefined();
    expect(hooks.validation.error).toHaveBeenCalled();
    const event = base();
    event.user.username = {} as never;
    await actionExports.onExecutePreUserRegistration!(event, hooks);
    expect(hooks.user.setUserMetadata).not.toHaveBeenCalled();
  });
  it.each(['alice@evil@school.edu', 'alice@other.edu', null])('rejects invalid or unapproved school email (%j)', async email => {
    const hooks = api();
    const event = base();
    event.user.email = email as never;
    await expect(actionExports.onExecutePreUserRegistration!(event, hooks)).resolves.toBeUndefined();
    expect(hooks.access.deny).toHaveBeenCalled();
  });
  it('stores trimmed names and never grants faculty permissions from request data', async () => {
    const hooks = api();
    const event = { ...base(), authorization: { roles: ['faculty'] } };
    await actionExports.onExecutePreUserRegistration!(event, hooks);
    expect(hooks.user.setUserMetadata.mock.calls).toEqual([['first_name', 'Alex'], ['last_name', 'Learner']]);
    expect(hooks.access.deny).not.toHaveBeenCalled();
    expect(hooks.validation.error).not.toHaveBeenCalled();
  });
});
