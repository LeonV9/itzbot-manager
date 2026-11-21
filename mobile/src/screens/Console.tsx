import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LogEntry } from '@itzbot/shared';
import { api, getToken, wsUrl } from '../api';
import { C } from '../theme';
import { Btn, Muted } from '../ui';

const MAX_LINES = 1500;
const color = (s: string) => (s === 'stderr' ? '#FF7B84' : s === 'system' ? C.warn : C.text);

export default function Console({ route }: any) {
  const { id } = route.params as { id: string; name: string };
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [conn, setConn] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const [follow, setFollow] = useState(true);
  const seen = useRef(new Set<string>()); const list = useRef<FlatList<LogEntry>>(null);
  const alive = useRef(true);

  const add = useCallback((batch: LogEntry[]) => {
    const fresh = batch.filter((e) => { const k = `${e.ts}|${e.stream}|${e.line}`; if (seen.current.has(k)) return false; seen.current.add(k); return true; });
    if (!fresh.length) return;
    setLines((p) => { const n = [...p, ...fresh]; return n.length > MAX_LINES ? n.slice(n.length - MAX_LINES) : n; });
  }, []);

  useEffect(() => {
    alive.current = true; let ws: WebSocket | null = null; let timer: ReturnType<typeof setTimeout>; let tries = 0; let ping: ReturnType<typeof setInterval>;
    const connect = () => {
      if (!alive.current) return;
      setConn(tries ? 'reconnecting' : 'connecting');
      ws = new WebSocket(wsUrl());
      ws.onopen = () => ws!.send(JSON.stringify({ type: 'auth', token: getToken() }));
      ws.onmessage = (m) => {
        const d = JSON.parse(String(m.data));
        if (d.type === 'ready') ws!.send(JSON.stringify({ type: 'subscribe', botId: id }));
        else if (d.type === 'subscribed') {
          tries = 0; setConn('live'); // history is loaded after subscribing so no line is lost; duplicates are filtered
          api.get<{ logs: LogEntry[] }>(`/api/bots/${id}/logs?limit=300`).then((r) => add(r.logs)).catch(() => undefined);
          clearInterval(ping); ping = setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'ping' })), 25000);
        } else if (d.type === 'log') add([{ botId: d.botId, ts: d.ts, stream: d.stream, line: d.line }]);
      };
      const retry = () => { clearInterval(ping); if (!alive.current) return; tries++; timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(tries, 4))); setConn('reconnecting'); };
      ws.onclose = retry; ws.onerror = () => ws?.close();
    };
    connect();
    return () => { alive.current = false; clearTimeout(timer); clearInterval(ping); ws?.close(); };
  }, [id, add]);

  useEffect(() => { if (follow && lines.length) list.current?.scrollToEnd({ animated: false }); }, [lines, follow]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#050506' }} edges={['left', 'right', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderBottomWidth: 1, borderColor: C.border }}>
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: conn === 'live' ? C.ok : C.warn }} />
        <Muted style={{ flex: 1 }}>{conn === 'live' ? 'Live' : conn === 'connecting' ? 'Connecting…' : 'Reconnecting…'} · {lines.length} lines</Muted>
        <Btn small kind="ghost" label={follow ? 'Following' : 'Follow'} onPress={() => setFollow((f) => !f)} />
        <Btn small kind="ghost" label="Clear" onPress={() => { setLines([]); }} />
      </View>
      <FlatList ref={list} data={lines} keyExtractor={(_, i) => String(i)} contentContainerStyle={{ padding: 10 }}
        onScrollBeginDrag={() => setFollow(false)} initialNumToRender={40} windowSize={11}
        ListEmptyComponent={<Muted>No output yet. Start the bot to see its console here.</Muted>}
        renderItem={({ item }) => (
          <Pressable>
            <Text style={{ fontFamily: 'monospace', fontSize: 11.5, lineHeight: 16, color: color(item.stream) }}>
              <Text style={{ color: C.muted }}>{new Date(item.ts).toLocaleTimeString()} </Text>{item.line}
            </Text>
          </Pressable>)} />
    </SafeAreaView>
  );
}
