import React, { useState } from 'react';
import type { BotView } from '@itzbot/shared';
import { api } from '../api';
import { errMsg } from '../hooks';
import { Banner, Btn, Card, Field, H, Muted, Screen, Title } from '../ui';

export default function AddBot({ navigation }: any) {
  const [name, setName] = useState(''); const [appId, setAppId] = useState(''); const [token, setToken] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ bot: BotView }>('/api/bots', { name: name.trim(), applicationId: appId.trim(), token: token.trim() });
      setToken(''); navigation.replace('ImportBot', { botId: r.bot.id });
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <Title sub="Step 1 of 2: identity. Next you import the code.">Add Bot</Title>
      <Banner text={err} />
      <Card>
        <Field label="Display name" value={name} onChangeText={setName} autoCapitalize="words" placeholder="My music bot" />
        <Field label="Application ID" value={appId} onChangeText={setAppId} keyboardType="number-pad" placeholder="123456789012345678" hint="A public number (17–20 digits) from Developer Portal → General Information. This is NOT the token." />
        <Field label="Bot Token (secret)" value={token} onChangeText={setToken} secureTextEntry placeholder="Paste the token" hint="From Developer Portal → Bot → Reset Token. It is verified with Discord, encrypted on your server, and never shown again." />
      </Card>
      <Btn label="Verify and add bot" busy={busy} disabled={!name.trim() || !appId.trim() || !token.trim()} onPress={submit} />
      <Card><H>Moving a bot from Replit?</H><Muted>Add it here, then import the same code from GitHub, a ZIP download of your Repl, or by uploading files. Any .env or Replit Secrets values become Environment variables on the bot's page. Stop the Repl afterwards so the bot is not logged in twice.</Muted></Card>
    </Screen>
  );
}
