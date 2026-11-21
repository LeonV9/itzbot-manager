import React, { useState } from 'react';
import { Alert } from 'react-native';
import type { ServerStatus } from '@itzbot/shared';
import { api, getBaseUrl } from '../api';
import { errMsg, usePoll } from '../hooks';
import { useSession } from '../session';
import { C, fmtUptime } from '../theme';
import { Banner, Btn, Card, Field, H, Muted, Screen, StatusPill, Title } from '../ui';

export default function Servers() {
  const ses = useSession();
  const { data: sv, error, reload } = usePoll(() => api.get<ServerStatus>('/api/server/status'), 8000);
  const [url, setUrl] = useState(ses.serverUrl); const [msg, setMsg] = useState<{ t: string; k: 'error' | 'info' } | null>(null); const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true); setMsg(null);
    try { await ses.testServer(url); await ses.setServer(url); setMsg({ k: 'info', t: 'Connection OK. If you changed the address you may need to sign in again.' }); void reload(); }
    catch (e) { setMsg({ k: 'error', t: errMsg(e) }); } finally { setBusy(false); }
  };
  return (
    <Screen onRefresh={reload}>
      <Title sub="The VPS that runs your bots">Server Management</Title>
      <Card accent={error ? C.red : sv?.status === 'healthy' ? C.ok : C.warn}>
        <H>Connection</H>
        <StatusPill status={error ? 'error' : sv ? (sv.status === 'healthy' ? 'online' : 'error') : 'starting'} />
        <Muted>{getBaseUrl()}</Muted>
        {error && <Banner text={error} />}
        {sv && <>
          <Muted>Docker: {sv.docker.reachable ? `running (v${sv.docker.version})` : `unreachable. ${sv.docker.error ?? ''}`}</Muted>
          <Muted>Database: {sv.database.ok ? 'connected' : 'DOWN'}</Muted>
          <Muted>Backend v{sv.backend.version}, up {fmtUptime(sv.backend.uptimeSeconds)}</Muted>
        </>}
      </Card>
      <Card>
        <H>Change server</H>
        <Banner kind="info" text={msg?.k === 'info' ? msg.t : null} /><Banner text={msg?.k === 'error' ? msg.t : null} />
        <Field label="Server URL" value={url} onChangeText={setUrl} keyboardType="url" hint="Use your HTTPS domain. The API key for this app is your account login: no secrets are stored in the APK." />
        <Btn label="Test and save" busy={busy} disabled={!url.trim()} onPress={test} />
      </Card>
      <Card><H>Account</H><Muted>Signed in as {ses.username || 'owner'}.</Muted>
        <Btn kind="danger" label="Sign out" onPress={() => Alert.alert('Sign out?', 'Your bots keep running on the server.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', onPress: () => void ses.signOut() }])} /></Card>
    </Screen>
  );
}
