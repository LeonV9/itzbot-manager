import React from 'react';
import { Text, View } from 'react-native';
import type { ServerStatus } from '@itzbot/shared';
import { api } from '../api';
import { usePoll } from '../hooks';
import { C, fmtBytes, fmtUptime } from '../theme';
import { Banner, Card, H, Loading, Meter, Muted, Screen, Stat, Title } from '../ui';

export default function Stats() {
  const { data: sv, error, loading, reload } = usePoll(() => api.get<ServerStatus>('/api/server/status'), 4000);
  if (loading && !sv) return <Screen><Loading /></Screen>;
  return (
    <Screen onRefresh={reload}>
      <Title sub="Real metrics from your VPS, refreshed every few seconds">Hosting Statistics</Title>
      <Banner text={error} />
      {sv && <>
        <Card>
          <Meter label="CPU" value={sv.host.cpuPercent} sub={`${sv.host.cores} cores`} />
          <Meter label="RAM" value={(sv.host.memUsedBytes / sv.host.memTotalBytes) * 100} sub={`${fmtBytes(sv.host.memUsedBytes)} / ${fmtBytes(sv.host.memTotalBytes)}`} />
          <Meter label="Disk (bot storage)" value={sv.host.diskTotalBytes ? (sv.host.diskUsedBytes / sv.host.diskTotalBytes) * 100 : 0} sub={`${fmtBytes(sv.host.diskUsedBytes)} / ${fmtBytes(sv.host.diskTotalBytes)}`} />
        </Card>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Stat label="Running containers" value={sv.runningContainers} />
          <Stat label="Combined bot uptime" value={fmtUptime(sv.totalBotUptimeSeconds)} />
        </View>
        <Muted>Server uptime {fmtUptime(sv.host.hostUptimeSeconds)} · Backend {sv.backend.version} up {fmtUptime(sv.backend.uptimeSeconds)}</Muted>
        <H>Per bot</H>
        {!sv.perBot.length && <Muted>No bots are running.</Muted>}
        {sv.perBot.map((b) => (
          <Card key={b.botId} accent={C.red}>
            <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>{b.name}</Text>
            <Meter label="CPU" value={b.cpuPercent} count={12} />
            <Meter label="Memory" value={b.memoryLimitBytes ? (b.memoryBytes / b.memoryLimitBytes) * 100 : 0} count={12} sub={`${fmtBytes(b.memoryBytes)} of ${fmtBytes(b.memoryLimitBytes)} limit · uptime ${fmtUptime(b.uptimeSeconds)}`} />
          </Card>))}
      </>}
    </Screen>
  );
}
