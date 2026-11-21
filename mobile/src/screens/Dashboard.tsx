import React from 'react';
import { Alert, View } from 'react-native';
import type { BotView, ServerStatus } from '@itzbot/shared';
import { api } from '../api';
import { BotCard } from '../BotCard';
import { errMsg, useAction, usePoll } from '../hooks';
import { fmtBytes, fmtUptime, C } from '../theme';
import { Banner, Btn, Card, Empty, H, Loading, Meter, Muted, Screen, Stat, StatusPill, Title } from '../ui';

interface Dash { counts: { total: number; max: number; online: number; offline: number; errors: number }; server: ServerStatus; bots: BotView[] }

export default function Dashboard({ navigation }: any) {
  const { data, error, loading, reload } = usePoll(() => api.get<Dash>('/api/dashboard'), 5000);
  const { busy, run } = useAction();
  const act = (b: BotView, a: 'start' | 'stop' | 'restart') => run(`${b.id}:${a}`, async () => { await api.post(`/api/bots/${b.id}/${a}`, {}, 120000); await reload(); }, (m) => { Alert.alert(`Could not ${a} ${b.name}`, m); void reload(); });
  if (loading && !data) return <Screen><Loading /></Screen>;
  const d = data; const sv = d?.server;
  return (
    <Screen onRefresh={reload} refreshing={false}>
      <Title sub="Live from your hosting server">Dashboard</Title>
      <Banner text={error ? `Server unreachable: ${error}` : null} />
      {d && sv && <>
        <Card accent={sv.status === 'healthy' ? C.ok : C.red}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <H>Hosting server</H><StatusPill status={sv.status === 'healthy' ? 'online' : 'error'} />
          </View>
          <Meter label="CPU" value={sv.host.cpuPercent} sub={`${sv.host.cores} cores`} />
          <Meter label="RAM" value={(sv.host.memUsedBytes / sv.host.memTotalBytes) * 100} sub={`${fmtBytes(sv.host.memUsedBytes)} of ${fmtBytes(sv.host.memTotalBytes)}`} />
          <Muted>Bot uptime combined: {fmtUptime(sv.totalBotUptimeSeconds)} · Docker {sv.docker.reachable ? sv.docker.version : 'unreachable'}</Muted>
          {!sv.docker.reachable && <Banner text={`Docker is not reachable: ${sv.docker.error ?? 'unknown error'}`} />}
        </Card>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Stat label={`Bots (max ${d.counts.max})`} value={d.counts.total} />
          <Stat label="Online" value={d.counts.online} color={C.ok} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Stat label="Offline" value={d.counts.offline} />
          <Stat label="Errors" value={d.counts.errors} color={d.counts.errors ? C.red : undefined} />
        </View>
        <H>Your bots</H>
        {d.bots.length === 0 && <Empty title="No bots yet" text="Add a bot, then import its code from GitHub, a ZIP or files." action={<Btn label="Add your first bot" onPress={() => navigation.navigate('AddBot')} />} />}
        {d.bots.map((b) => <BotCard key={b.id} bot={b} busy={busy} onAction={(a) => act(b, a)} onOpen={() => navigation.navigate('BotDetails', { id: b.id })} onConsole={() => navigation.navigate('Console', { id: b.id, name: b.name })} onSettings={() => navigation.navigate('BotDetails', { id: b.id })} />)}
        {d.counts.total > 0 && d.counts.total < d.counts.max && <Btn kind="ghost" label="Add bot" onPress={() => navigation.navigate('AddBot')} />}
      </>}
    </Screen>
  );
}
void errMsg;
