// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {authErrorMessage} from './errors';
describe('safe sign-in errors',()=>{
  it('does not echo tokens, authorization codes or arbitrary server descriptions',()=>{
    const message=authErrorMessage({error:'invalid_request',error_description:'secret-token sensitive-code arbitrary text'});
    expect(message).not.toContain('secret-token');expect(message).not.toContain('sensitive-code');
  });
  it('explains denied user-delegated API grants without echoing the description',()=>{
    const message=authErrorMessage({error:'invalid_request',error_description:'Client sensitive-token is not authorized to access resource server anything'});
    expect(message).toContain('User-Delegated Access');expect(message).not.toContain('sensitive-token');
  });
});
