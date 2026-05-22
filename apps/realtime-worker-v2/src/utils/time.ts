export function nowIso() {
  return new Date().toISOString();
}

export function parseTime(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
