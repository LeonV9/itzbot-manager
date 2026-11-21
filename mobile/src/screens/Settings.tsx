import React, { useEffect, useState } from 'react';
import { api, getBaseUrl } from '../api';
import { errMsg } from '../hooks';
import { Banner, Btn, Card, Field, H, Muted, Screen, Title } from '../ui';

export default function Settings({ navigation }: any) {
  const [mem, setMem] = useState(''); const [cpu, setCpu] = useState(''); const [lim, setLim] = useState<{ maxMemoryMb: number; maxCpus: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.get<{ settings: { defaultMemoryMb: number; defaultCpus: number }; limits: { maxMemoryMb: number; maxCpus: number } }>('/api/settings').then((r) => { setMem(String(r.settings.defaultMemoryMb)); setCpu(String(r.settings.defaultCpus)); setLim(r.limits); }).catch((e) => setErr(errMsg(e))); }, []);
  const save = async () => { setErr(null); setMsg(null); try { await api.put('/api/settings', { defaultMemoryMb: parseInt(mem, 10), defaultCpus: parseFloat(cpu) }); setMsg('Saved. New limits apply the next time each bot starts.'); } catch (e) { setErr(errMsg(e)); } };
  return (
    <Screen>
      <Title>Settings</Title>
      <Banner text={err} /><Banner kind="info" text={msg} />
      <Card>
        <H>Default limits per bot</H>
        <Muted>Each bot runs in its own container with these caps unless you override them in the bot's configuration.{lim ? ` Maximum: ${lim.maxMemoryMb} MB, ${lim.maxCpus} CPU.` : ''}</Muted>
        <Field label="RAM (MB)" value={mem} onChangeText={setMem} keyboardType="number-pad" />
        <Field label="CPU (cores, e.g. 0.5)" value={cpu} onChangeText={setCpu} keyboardType="decimal-pad" />
        <Btn label="Save defaults" onPress={save} />
      </Card>
      <Card><H>Account and security</H><Muted>Change password, sign out of all devices.</Muted><Btn kind="ghost" label="Open" onPress={() => navigation.navigate('Account')} /></Card>
      <Card><H>About</H><Muted>ItzBot Manager 1.0.0{'\n'}Server: {getBaseUrl()}</Muted></Card>
    </Screen>
  );
}
