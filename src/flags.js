// Convert a 2-letter ISO country code into a flag emoji (regional indicators).
export function flagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '🎓';
  const BASE = 0x1f1e6;
  const cc = countryCode.toUpperCase();
  const a = cc.charCodeAt(0) - 65;
  const b = cc.charCodeAt(1) - 65;
  if (a < 0 || a > 25 || b < 0 || b > 25) return '🎓';
  return String.fromCodePoint(BASE + a, BASE + b);
}
