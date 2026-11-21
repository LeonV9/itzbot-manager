import React, { useState } from 'react';
import { Alert } from 'react-native';
import { api } from '../api';
import { errMsg } from '../hooks';
import { useSession } from '../session';
import { Banner, Btn, Card, Field, H, Muted, Screen, Title } from '../ui';

export default function Account() {
  const ses = useSession();
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const change = async () => {
    setErr(null); setMsg(null);
    if (pw !== pw2) return setErr('The new passwords do not match.');
    setBusy(true);
    try { const r = await api.post<{ token: string }>('/api/auth/change-password', { currentPassword: cur, newPassword: pw }); await ses.setToken(r.token); setCur(''); setPw(''); setPw2(''); setMsg('Password changed. All other devices were signed out.'); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Screen>
      <Title sub={`Signed in as ${ses.username || 'owner'}`}>Account & Security</Title>
      <Banner text={err} /><Banner kind="info" text={msg} />
      <Card>
        <H>Change password</H>
        <Field label="Current password" value={cur} onChangeText={setCur} secureTextEntry />
        <Field label="New password" value={pw} onChangeText={setPw} secureTextEntry hint="At least 10 characters." />
        <Field label="Repeat new password" value={pw2} onChangeText={setPw2} secureTextEntry />
        <Btn label="Change password" busy={busy} disabled={!cur || pw.length < 10} onPress={change} />
      </Card>
      <Card>
        <H>Sessions</H><Muted>Signing out everywhere invalidates every logged-in device, including this one.</Muted>
        <Btn kind="danger" label="Sign out of all devices" onPress={() => Alert.alert('Sign out everywhere?', 'You will need to sign in again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: async () => { try { await api.post('/api/auth/logout-all', {}); } finally { await ses.signOut(); } } }])} />
      </Card>
      <Muted>Your bot tokens are encrypted on the server and are never sent back to this app.</Muted>
    </Screen>
  );
}
