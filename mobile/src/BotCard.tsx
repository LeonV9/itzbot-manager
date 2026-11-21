import React from 'react';
import { Text, View } from 'react-native';
import type { BotView } from '@itzbot/shared';
import { C, fmtUptime, statusColor } from './theme';
import { Btn, Card, Muted, StatusPill } from './ui';

export function BotCard({ bot, busy, onAction, onOpen, onConsole, onSettings }: {
  bot: BotView; busy: string | null; onAction: (a: 'start' | 'stop' | 'restart') => void; onOpen: () => void; onConsole: () => void; onSettings: () => void;
}) {
  const up = ['online', 'starting', 'restarting', 'unhealthy'].includes(bot.status);
  const mine = busy?.startsWith(bot.id) ? busy.split(':')[1] : null;
  return (
    <Card accent={statusColor(bot.status)}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text onPress={onOpen} style={{ color: C.text, fontSize: 18, fontWeight: '800', flex: 1 }} numberOfLines={1}>{bot.name}</Text>
        <StatusPill status={bot.status} />
      </View>
      <View style={{ flexDirection: 'row', gap: 18 }}>
        <View><Muted>Uptime</Muted><Text style={{ color: C.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{fmtUptime(bot.uptimeSeconds)}</Text></View>
        <View><Muted>Restarts</Muted><Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>{bot.restartCount}</Text></View>
        {!bot.hasSource && <View style={{ flex: 1 }}><Muted>No source imported</Muted></View>}
      </View>
      {bot.lastError && (bot.status === 'error' || bot.status === 'unhealthy' || bot.status === 'restarting') ? <Text style={{ color: '#FF8A93', fontSize: 12 }} numberOfLines={3}>{bot.lastError}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn small flex label="Start" disabled={up || !!busy} busy={mine === 'start'} onPress={() => onAction('start')} />
        <Btn small flex kind="ghost" label="Stop" disabled={!up || !!busy} busy={mine === 'stop'} onPress={() => onAction('stop')} />
        <Btn small flex kind="ghost" label="Restart" disabled={!up || !!busy} busy={mine === 'restart'} onPress={() => onAction('restart')} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Btn small flex kind="ghost" label="Console" onPress={onConsole} />
        <Btn small flex kind="ghost" label="Settings" onPress={onSettings} />
      </View>
    </Card>
  );
}
