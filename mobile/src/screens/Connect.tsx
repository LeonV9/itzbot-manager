import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useSession } from '../session';
import { errMsg } from '../hooks';
import { C } from '../theme';
import { Banner, Btn, Card, Field, Muted, Screen } from '../ui';

export default function Connect() {
  const ses = useSession();
  const [url, setUrl] = useState(ses.serverUrl);
  const [step, setStep] = useState<'server' | 'login'>(ses.serverUrl ? 'login' : 'server');
  const [user, setUser] = useState(ses.username); const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const go = async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };

  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: 8, paddingTop: 30 }}>
        <Image source={require('../../assets/icon.png')} style={{ width: 96, height: 96, borderRadius: 22 }} />
        <Text style={{ color: C.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 }}>ItzBot Manager</Text>
        <Muted>Control your Discord bots from your own server.</Muted>
      </View>
      <Banner text={err} />
      {step === 'server' ? (
        <Card>
          <Field label="Server URL" value={url} onChangeText={setUrl} placeholder="https://bots.example.com" keyboardType="url" hint="The address of the ItzBot backend on your VPS. Use https:// so your login and bot tokens are encrypted in transit." />
          <Btn label="Test connection" busy={busy} disabled={!url.trim()} onPress={() => go(async () => { await ses.testServer(url); await ses.setServer(url); setStep('login'); })} />
        </Card>
      ) : (
        <Card>
          <Muted>Server: {ses.serverUrl}</Muted>
          <Field label="Username" value={user} onChangeText={setUser} />
          <Field label="Password" value={pw} onChangeText={setPw} secureTextEntry hint="At least 10 characters when creating the account." />
          <Btn label="Sign in" busy={busy} disabled={!user || !pw} onPress={() => go(() => ses.signIn(user, pw))} />
          <Btn kind="ghost" label="Create owner account (first-time setup)" disabled={busy || !user || pw.length < 10} onPress={() => go(() => ses.register(user, pw))} />
          <Btn kind="ghost" small label="Change server" onPress={() => setStep('server')} />
        </Card>
      )}
    </Screen>
  );
}
