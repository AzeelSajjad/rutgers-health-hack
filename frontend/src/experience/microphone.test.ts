import {describe,expect,it} from 'vitest';
import {microphoneErrorMessage} from './microphone';
describe('microphone diagnostics',()=>{
  it.each([
    ['NotAllowedError','Microphone access was blocked'],
    ['SecurityError','Microphone access was blocked'],
    ['NotFoundError','No microphone was found'],
    ['NotReadableError','The microphone could not be opened'],
  ])('explains %s with an actionable recovery', (name,message)=>{
    const error=new Error('Device error');error.name=name;
    expect(microphoneErrorMessage(error)).toContain(message);
  });
  it('preserves the unsupported sample-rate explanation',()=>{
    const message='This browser cannot capture at the required rate. Type your question instead.';
    expect(microphoneErrorMessage(new Error(message))).toBe(message);
  });
});
