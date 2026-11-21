import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import type { Analysis, BotView } from '@itzbot/shared';
import { api } from '../api';
import { errMsg, usePoll } from '../hooks';
import { C } from '../theme';
import { Banner, Btn, Card, Empty, Field, H, Loading, Muted, Screen, Title } from '../ui';

type Method = 'github' | 'zip' | 'manual';
const form = (assets: DocumentPicker.DocumentPickerAsset[], field: string) => {
  const f = new FormData();
  for (const a of assets) f.append(field, { uri: a.uri, name: a.name, type: a.mimeType ?? 'application/octet-stream' } as any);
  return f;
};

export default function ImportBot({ navigation, route }: any) {
  const [botId, setBotId] = useState<string | undefined>(route.params?.botId);
  const bots = usePoll(() => api.get<{ bots: BotView[] }>('/api/bots'), 30000);
  const [method, setMethod] = useState<Method>('github');
  const [url, setUrl] = useState(''); const [ref, setRef] = useState(''); const [gh, setGh] = useState('');
  const [picked, setPicked] = useState<DocumentPicker.DocumentPickerAsset[]>([]);
  const [res, setRes] = useState<Analysis | null>(null);
  const [start, setStart] = useState(''); const [entry, setEntry] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [saved, setSaved] = useState(false);
  const bot = bots.data?.bots.find((b) => b.id === botId);

  if (!botId) {
    if (bots.loading) return <Screen><Loading /></Screen>;
    return (
      <Screen><Title sub="Choose which bot receives the code">Import Bot</Title>
        {!bots.data?.bots.length && <Empty title="No bots yet" text="Add a bot first." action={<Btn label="Add bot" onPress={() => navigation.replace('AddBot')} />} />}
        {bots.data?.bots.map((b) => <Card key={b.id}><H>{b.name}</H><Btn kind="ghost" label="Import into this bot" onPress={() => setBotId(b.id)} /></Card>)}
      </Screen>
    );
  }

  const pick = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: method === 'zip' ? ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'] : '*/*', multiple: method === 'manual', copyToCacheDirectory: true });
    if (!r.canceled) setPicked(r.assets);
  };
  const doImport = async () => {
    setBusy(true); setErr(null); setRes(null); setSaved(false);
    try {
      let r: { analysis: Analysis; appliedDefaults: boolean };
      if (method === 'github') r = await api.post(`/api/bots/${botId}/import/github`, { url: url.trim(), ref: ref.trim() || undefined, githubToken: gh.trim() || undefined }, 180000);
      else if (method === 'zip') r = await api.upload(`/api/bots/${botId}/import/zip`, form(picked.slice(0, 1), 'file'));
      else r = await api.upload(`/api/bots/${botId}/import/manual`, form(picked, 'file'));
      setGh(''); setRes(r.analysis);
      const fresh = (await api.get<{ bot: BotView }>(`/api/bots/${botId}`)).bot;
      setStart(fresh.config.startCommand); setEntry(fresh.config.entryFile ?? r.analysis.suggestedEntry ?? '');
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const saveCfg = async () => {
    setBusy(true); setErr(null);
    try { await api.patch(`/api/bots/${botId}`, { startCommand: start.trim(), entryFile: entry.trim() || null }); setSaved(true); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const ready = method === 'github' ? !!url.trim() : picked.length > 0;

  return (
    <Screen>
      <Title sub={bot ? `Into “${bot.name}”` : undefined}>Import Bot</Title>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['github', 'zip', 'manual'] as Method[]).map((m) => (
          <Pressable key={m} onPress={() => { setMethod(m); setPicked([]); setRes(null); }} style={{ flex: 1, alignItems: 'center', padding: 12, borderRadius: 10, backgroundColor: method === m ? C.red : C.surface2 }}>
            <Text style={{ color: C.text, fontWeight: '700' }}>{m === 'github' ? 'GitHub' : m === 'zip' ? 'ZIP' : 'Files'}</Text>
          </Pressable>))}
      </View>
      <Banner text={err} />
      <Card>
        {method === 'github' && <>
          <Field label="Repository URL" value={url} onChangeText={setUrl} keyboardType="url" placeholder="https://github.com/you/your-bot" />
          <Field label="Branch or tag (optional)" value={ref} onChangeText={setRef} placeholder="default branch" />
          <Field label="GitHub access token (private repos only)" value={gh} onChangeText={setGh} secureTextEntry hint="Create a fine-grained personal access token with read-only “Contents” access to this repository. It is used once for this download and is not stored." />
        </>}
        {method === 'zip' && <><Muted>Upload a .zip of your project (for a Repl: ⋮ menu → Download as zip). node_modules, .git and .env are not kept.</Muted><Btn kind="ghost" label={picked[0] ? picked[0].name : 'Choose ZIP file'} onPress={pick} /></>}
        {method === 'manual' && <><Muted>Select your source files (index.js, package.json, commands…). Android's picker cannot select folders, so use ZIP for projects with sub-folders.</Muted><Btn kind="ghost" label={picked.length ? `${picked.length} file(s) selected` : 'Choose files'} onPress={pick} /></>}
        <Btn label={bot?.hasSource ? 'Import and replace source' : 'Import'} busy={busy} disabled={!ready} onPress={doImport} />
        {bot?.hasSource && <Muted>The bot must be stopped. Existing code is replaced; settings are kept.</Muted>}
      </Card>
      {res && <Card accent={C.ok}>
        <H>Project analysed</H>
        <Muted>{res.fileCount} files · {res.discordLib ? `${res.discordLib.name} ${res.discordLib.version}` : 'no Discord library detected'}</Muted>
        <Muted>Entry point: {res.suggestedEntry ?? 'not detected'} · package.json: {res.hasPackageJson ? 'found' : 'missing'}</Muted>
        <Muted>Dependencies: {Object.keys(res.dependencies).length}{res.scripts.start ? ` · npm start = ${res.scripts.start}` : ''}</Muted>
        {res.warnings.map((w, i) => <Banner key={i} kind="warn" text={w} />)}
        <Field label="Start command" value={start} onChangeText={setStart} hint="e.g. npm start or node index.js" />
        <Field label="Entry file" value={entry} onChangeText={setEntry} placeholder="index.js" />
        <Btn kind="ghost" label={saved ? 'Saved ✓' : 'Save settings'} busy={busy} onPress={saveCfg} />
        <Btn label="Open bot" onPress={() => navigation.replace('BotDetails', { id: botId })} />
      </Card>}
    </Screen>
  );
}
