import { App } from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../lib/config.js';
import { cdkContext } from './helpers.js';

const withGithub = (github: object) =>
  new App({
    context: {
      spaceSports: {
        ...cdkContext.spaceSports,
        github: { ...cdkContext.spaceSports.github, ...github },
      },
    },
  }).node;

describe('loadConfig', () => {
  it('aceita o cdk.json', () => {
    expect(loadConfig(new App({ context: cdkContext }).node).account).toBe('123456789012');
  });

  it('recusa o sub no formato só com nomes, que a AWS não reconheceria', () => {
    const node = withGithub({ subjectPrefix: 'repo:Space-Sports-Apps/mobile-web' });
    expect(() => loadConfig(node)).toThrow(/subjectPrefix/);
  });

  it('recusa um sub de outro repositório', () => {
    const node = withGithub({ subjectPrefix: 'repo:Space-Sports-Apps@1/outro@2' });
    expect(() => loadConfig(node)).toThrow(/subjectPrefix/);
  });

  it('exige a configuração', () => {
    expect(() => loadConfig(new App().node)).toThrow();
  });
});
