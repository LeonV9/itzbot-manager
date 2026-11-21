import { AppError } from './errors';

/** Verifies the token with Discord and that it belongs to the given Application ID. */
export async function validateDiscordBot(token: string, applicationId: string): Promise<{ botName: string }> {
  let res: Response;
  try {
    res = await fetch('https://discord.com/api/v10/oauth2/applications/@me', {
      headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError(502, 'DISCORD_UNREACHABLE', 'Could not reach Discord to verify the token. Check the server\'s internet connection and try again.');
  }
  if (res.status === 401) throw new AppError(400, 'INVALID_DISCORD_TOKEN', 'Discord rejected this Bot Token. Copy it again from Developer Portal → your application → Bot → Reset Token.');
  if (!res.ok) throw new AppError(502, 'DISCORD_ERROR', `Discord returned HTTP ${res.status} while verifying the token.`);
  const j = (await res.json()) as { id?: string; name?: string; bot?: { username?: string } };
  if (j.id !== applicationId) {
    throw new AppError(400, 'APPLICATION_ID_MISMATCH', 'This token belongs to a different Discord application than the Application ID you entered. The Application ID is the number on the General Information page; the Bot Token is the secret on the Bot page.');
  }
  return { botName: j.bot?.username ?? j.name ?? 'bot' };
}
