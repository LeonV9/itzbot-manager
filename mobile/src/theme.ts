export const C = {
  bg: '#0B0B0C', surface: '#151517', surface2: '#1E1E21', border: '#2C2C31',
  red: '#E11D2E', redDim: '#3A0F13', text: '#F5F5F6', muted: '#8E8E97', ok: '#34C46B', warn: '#F2A93B',
};
export const R = { card: 14, chip: 8, input: 10 };
export const statusColor = (s: string) =>
  s === 'online' ? C.ok : s === 'starting' || s === 'installing' || s === 'restarting' ? C.warn : s === 'error' || s === 'unhealthy' ? C.red : C.muted;
export const statusLabel = (s: string) => ({ online: 'Online', offline: 'Offline', starting: 'Starting', installing: 'Installing', restarting: 'Restarting', unhealthy: 'Unhealthy', error: 'Error' } as Record<string, string>)[s] ?? s;
export const MAX_BOTS = 10;

export function fmtUptime(sec: number): string {
  if (!sec) return '–';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${sec % 60}s` : `${sec}s`;
}
export function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return (b / 1024 ** 3).toFixed(1) + ' GB';
  if (b >= 1024 ** 2) return Math.round(b / 1024 ** 2) + ' MB';
  return Math.round(b / 1024) + ' KB';
}
