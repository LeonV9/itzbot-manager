import React, { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import type { BotView } from '@itzbot/shared';
import { api } from '../api';
import { errMsg, useAction, usePoll } from '../hooks';
import { C, fmtUptime } from '../theme';
import { Banner, Btn, Card, Field, H, Loading, Muted, Screen, StatusPill, Title } from '../ui';

export default function BotDetails({ navigation, route }: any) {
  const id: string = route.params.id;
  const { data, error, loading, reload } = usePoll(() => api.get<{ bot: BotView }>(`/api/bots/${id}`), 4000);
  const { busy, run } = useAction();
  const bot = data?.bot;
  const [name, setName] = useState(''); const [cmd, setCmd] = useState(''); const [entry, setEntry] = useState('');
  const [mem, setMem] = useState(''); const [cpu, setCpu] = useState('');
  const [envKey, setEnvKey] = useState(''); const [envVal, setEnvVal] = useState(''); const [token, setToken] = useState('');
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { if (bot && !loaded) { setName(bot.name); setCmd(bot.config.startCommand); setEntry(bot.config.entryFile ?? ''); setMem(bot.config.memoryMb?.toString() ?? ''); setCpu(bot.config.cpus?.toString() ?? ''); setLoaded(true); } }, [bot, loaded]);
  if (loading && !bot) return <Screen><Loading /></Screen>;
  if (!bot) return <Screen><Banner text={error ?? 'Bot not found.'} /></Screen>;
  const up = ['online', 'starting', 'restarting', 'unhealthy'].includes(bot.status);
  const fail = (m: string) => { setMsg(null); setErr(m); };
  const ok = (m: string) => { setErr(null); setMsg(m); void reload(); };
  const patch = (key: string, body: object, done: string) => run(key, async () => { await api.patch(`/api/bots/${id}`, body); ok(done); }, fail);
  const action = (a: 'start' | 'stop' | 'restart') => run(a, async () => { await api.post(`/api/bots/${id}/${a}`, {}, 120000); ok(`Bot ${a === 'stop' ? 'stopped' : a === 'start' ? 'started' : 'restarted'}.`); }, (m) => { fail(m); void reload(); });

  return (
    <Screen onRefresh={reload}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title sub={`Application ID ${bot.applicationId}`}>{bot.name}</Title><StatusPill status={bot.status} /></View>
      <Banner text={err} /><Banner kind="info" text={msg} />
      {bot.lastError && ['error', 'unhealthy', 'restarting'].includes(bot.status) && <Banner text={bot.lastError} />}
      <Card accent={C.red}>
        <Muted>Uptime {fmtUptime(bot.uptimeSeconds)} · Restarts {bot.restartCount} · Health {bot.health}{bot.lastExitCode !== null && !up ? ` · Last exit code ${bot.lastExitCode}` : ''}</Muted>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn flex small label="Start" disabled={up || !!busy} busy={busy === 'start'} onPress={() => action('start')} />
          <Btn flex small kind="ghost" label="Stop" disabled={!up || !!busy} busy={busy === 'stop'} onPress={() => action('stop')} />
          <Btn flex small kind="ghost" label="Restart" disabled={!up || !!busy} busy={busy === 'restart'} onPress={() => action('restart')} />
        </View>
        <Btn kind="ghost" small label="Open live console" onPress={() => navigation.navigate('Console', { id, name: bot.name })} />
      </Card>

      <Card>
        <H>Source code</H>
        <Muted>{bot.sourceType ? `Imported from ${bot.sourceType}${bot.sourceUrl ? ` (${bot.sourceUrl})` : ''}` : 'No code imported yet.'}</Muted>
        <Btn kind="ghost" label={bot.hasSource ? 'Update / re-import source' : 'Import source'} onPress={() => navigation.navigate('ImportBot', { botId: id })} />
      </Card>

      <Card>
        <H>Configuration</H>
        <Field label="Display name" value={name} onChangeText={setName} autoCapitalize="words" />
        <Field label="Start command" value={cmd} onChangeText={setCmd} />
        <Field label="Entry file" value={entry} onChangeText={setEntry} placeholder="index.js" />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Field label="RAM limit (MB)" value={mem} onChangeText={setMem} keyboardType="number-pad" placeholder="default" /></View>
          <View style={{ flex: 1 }}><Field label="CPU limit" value={cpu} onChangeText={setCpu} keyboardType="decimal-pad" placeholder="default" /></View>
        </View>
        <Btn label="Save configuration" busy={busy === 'cfg'} onPress={() => patch('cfg', { name: name.trim(), startCommand: cmd.trim(), entryFile: entry.trim() || null, memoryMb: mem ? parseInt(mem, 10) : null, cpus: cpu ? parseFloat(cpu) : null }, up ? 'Saved. Restart the bot to apply.' : 'Saved.')} />
      </Card>

      <Card>
        <H>Environment variables</H>
        <Muted>Values are encrypted and never shown. Adding an existing name replaces its value.</Muted>
        {bot.config.envKeys.map((k) => (
          <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: C.text, fontWeight: '600' }}>{k}</Text>
            <Btn small kind="danger" label="Remove" onPress={() => patch('env', { env: { [k]: null } }, `Removed ${k}.`)} />
          </View>))}
        <Field label="Name" value={envKey} onChangeText={(t) => setEnvKey(t.toUpperCase())} placeholder="GUILD_ID" />
        <Field label="Value" value={envVal} onChangeText={setEnvVal} secureTextEntry />
        <Btn kind="ghost" label="Save variable" disabled={!envKey || !envVal} busy={busy === 'env'} onPress={() => patch('env', { env: { [envKey]: envVal } }, `Saved ${envKey}.`).then(() => { setEnvKey(''); setEnvVal(''); })} />
      </Card>

      <Card>
        <H>Replace bot token</H>
        <Muted>The current token is never displayed. Paste a new one; it is verified with Discord first.</Muted>
        <Field label="New Bot Token" value={token} onChangeText={setToken} secureTextEntry />
        <Btn kind="ghost" label="Verify and replace token" disabled={!token} busy={busy === 'tok'} onPress={() => run('tok', async () => { await api.put(`/api/bots/${id}/token`, { token: token.trim() }); setToken(''); ok(up ? 'Token replaced. Restart the bot to use it.' : 'Token replaced.'); }, fail)} />
      </Card>

      <Card>
        <H>Danger zone</H>
        <Btn kind="danger" label="Delete bot" onPress={() => Alert.alert('Delete bot?', `“${bot.name}”, its files, logs and token will be permanently removed from your server.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void run('del', async () => { await api.del(`/api/bots/${id}`); navigation.popToTop(); }, fail) }])} />
      </Card>
    </Screen>
  );
}
void errMsg;
