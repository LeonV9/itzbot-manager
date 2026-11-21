import React from 'react';
import { Alert } from 'react-native';
import type { BotView } from '@itzbot/shared';
import { api } from '../api';
import { BotCard } from '../BotCard';
import { useAction, usePoll } from '../hooks';
import { MAX_BOTS } from '../theme';
import { Banner, Btn, Empty, Loading, Screen, Title } from '../ui';

export default function MyBots({ navigation }: any) {
  const { data, error, loading, reload } = usePoll(() => api.get<{ bots: BotView[]; max: number }>('/api/bots'), 5000);
  const { busy, run } = useAction();
  const act = (b: BotView, a: 'start' | 'stop' | 'restart') => run(`${b.id}:${a}`, async () => { await api.post(`/api/bots/${b.id}/${a}`, {}, 120000); await reload(); }, (m) => { Alert.alert(`Could not ${a} ${b.name}`, m); void reload(); });
  if (loading && !data) return <Screen><Loading /></Screen>;
  const bots = data?.bots ?? []; const max = data?.max ?? MAX_BOTS;
  return (
    <Screen onRefresh={reload}>
      <Title sub={`${bots.length} of ${max} slots used`}>My Bots</Title>
      <Banner text={error} />
      <Btn label="Add bot" disabled={bots.length >= max} onPress={() => navigation.navigate('AddBot')} />
      <Btn kind="ghost" label="Import code into a bot" disabled={!bots.length} onPress={() => navigation.navigate('ImportBot', {})} />
      {!bots.length && !loading && <Empty title="Nothing here yet" text="Bots you add will appear here and keep running on your server 24/7." />}
      {bots.map((b) => <BotCard key={b.id} bot={b} busy={busy} onAction={(a) => act(b, a)} onOpen={() => navigation.navigate('BotDetails', { id: b.id })} onConsole={() => navigation.navigate('Console', { id: b.id, name: b.name })} onSettings={() => navigation.navigate('BotDetails', { id: b.id })} />)}
    </Screen>
  );
}
