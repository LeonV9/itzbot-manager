import React from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, R, statusColor, statusLabel } from './theme';

export function Screen({ children, onRefresh, refreshing = false, pad = true }: { children: React.ReactNode; onRefresh?: () => void; refreshing?: boolean; pad?: boolean }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={{ padding: pad ? 16 : 0, paddingBottom: 40, gap: 14 }} keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.red} colors={[C.red]} progressBackgroundColor={C.surface} /> : undefined}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
export const Title = ({ children, sub }: { children: string; sub?: string }) => (
  <View style={{ gap: 2 }}><Text style={s.title}>{children}</Text>{sub ? <Text style={s.muted}>{sub}</Text> : null}</View>
);
export const H = ({ children }: { children: string }) => <Text style={s.h}>{children}</Text>;
export const Muted = ({ children, style }: { children: React.ReactNode; style?: object }) => <Text style={[s.muted, style]}>{children}</Text>;

export function Card({ children, accent, style }: { children: React.ReactNode; accent?: string; style?: ViewStyle }) {
  return (
    <View style={[s.card, style]}>
      {accent ? <View style={[s.accent, { backgroundColor: accent }]} /> : null}
      <View style={{ flex: 1, padding: 14, gap: 10 }}>{children}</View>
    </View>
  );
}

type BtnKind = 'primary' | 'ghost' | 'danger';
export function Btn({ label, onPress, kind = 'primary', small, disabled, busy, flex }: { label: string; onPress: () => void; kind?: BtnKind; small?: boolean; disabled?: boolean; busy?: boolean; flex?: boolean }) {
  const bg = kind === 'primary' ? C.red : kind === 'danger' ? C.redDim : C.surface2;
  const fg = kind === 'danger' ? '#FF6B76' : C.text;
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} android_ripple={{ color: '#ffffff22' }}
      style={({ pressed }) => [s.btn, small && s.btnSm, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1, borderColor: kind === 'ghost' ? C.border : bg }, flex && { flex: 1 }]}>
      {busy ? <ActivityIndicator color={fg} size="small" /> : <Text style={[s.btnText, { color: fg }, small && { fontSize: 13 }]}>{label}</Text>}
    </Pressable>
  );
}

export const StatusPill = ({ status }: { status: string }) => (
  <View style={[s.pill, { borderColor: statusColor(status) }]}>
    <View style={[s.dot, { backgroundColor: statusColor(status) }]} /><Text style={[s.pillText, { color: statusColor(status) }]}>{statusLabel(status)}</Text>
  </View>
);

export function Field({ label, hint, ...p }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor="#5E5E66" autoCapitalize="none" autoCorrect={false} {...p} style={[s.input, p.style]} />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Banner({ text, kind = 'error' }: { text: string | null; kind?: 'error' | 'warn' | 'info' }) {
  if (!text) return null;
  const col = kind === 'error' ? C.red : kind === 'warn' ? C.warn : C.muted;
  return <View style={[s.banner, { borderColor: col }]}><Text style={{ color: C.text, fontSize: 13, lineHeight: 18 }}>{text}</Text></View>;
}

/** HUD-style segmented meter: the signature element of the dashboard. */
export function Meter({ label, value, sub, count = 20 }: { label: string; value: number; sub?: string; count?: number }) {
  const v = Math.max(0, Math.min(100, value)); const lit = Math.round((v / 100) * count);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={s.label}>{label}</Text><Text style={s.big}>{Math.round(v)}%</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {Array.from({ length: count }, (_, i) => <View key={i} style={{ flex: 1, height: 14, borderRadius: 2, backgroundColor: i < lit ? (v > 85 ? C.red : C.red) : C.surface2, opacity: i < lit ? 0.55 + 0.45 * (i / count) : 1 }} />)}
      </View>
      {sub ? <Text style={s.hint}>{sub}</Text> : null}
    </View>
  );
}
export const Stat = ({ label, value, color }: { label: string; value: string | number; color?: string }) => (
  <View style={[s.stat]}><Text style={[s.statVal, color ? { color } : null]}>{value}</Text><Text style={s.hint}>{label}</Text></View>
);
export const Loading = () => <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={C.red} size="large" /></View>;
export const Empty = ({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) => (
  <Card><Text style={s.h}>{title}</Text><Text style={s.muted}>{text}</Text>{action}</Card>
);

const s = StyleSheet.create({
  title: { color: C.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 },
  h: { color: C.text, fontSize: 17, fontWeight: '700' },
  muted: { color: C.muted, fontSize: 14, lineHeight: 20 },
  label: { color: C.muted, fontSize: 13, fontWeight: '600' },
  hint: { color: C.muted, fontSize: 12, lineHeight: 17 },
  big: { color: C.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  card: { backgroundColor: C.surface, borderRadius: R.card, borderWidth: 1, borderColor: C.border, flexDirection: 'row', overflow: 'hidden' },
  accent: { width: 4 },
  btn: { minHeight: 44, borderRadius: R.chip, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  btnSm: { minHeight: 36, paddingHorizontal: 12 },
  btnText: { fontSize: 15, fontWeight: '700' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 12, fontWeight: '700' },
  input: { backgroundColor: C.surface2, color: C.text, borderRadius: R.input, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, minHeight: 46, fontSize: 15 },
  banner: { borderWidth: 1, borderRadius: R.chip, padding: 12, backgroundColor: C.surface },
  stat: { flex: 1, backgroundColor: C.surface, borderRadius: R.card, borderWidth: 1, borderColor: C.border, padding: 12, gap: 2 },
  statVal: { color: C.text, fontSize: 26, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
