// One game day lasts twelve minutes of active play. The simulation clock is
// the sole time source, so tutorials, menus, background tabs and pause freeze it.
export const DAY_DURATION_SECONDS = 720;
export const GAME_MINUTES_PER_SECOND = 1440 / DAY_DURATION_SECONDS;
export const DEFAULT_START_MINUTES = 18 * 60 + 30;
export const START_TIMES = Object.freeze([
  Object.freeze({ minutes: 1110, name: '18:30 · SOIR' }),
  Object.freeze({ minutes: 360, name: '06:00 · AUBE' }),
  Object.freeze({ minutes: 720, name: '12:00 · JOUR' }),
  Object.freeze({ minutes: 0, name: '00:00 · NUIT' }),
]);

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};

export function normaliseStartMinutes(value) {
  return Number.isFinite(value) ? ((value % 1440) + 1440) % 1440 : DEFAULT_START_MINUTES;
}

export function timeOfDay(game = {}) {
  const elapsed = Number.isFinite(game.elapsed) ? Math.max(0, game.elapsed) : 0;
  const total = normaliseStartMinutes(game.startClockMinutes) + elapsed * GAME_MINUTES_PER_SECOND;
  const minutes = total % 1440, hours = minutes / 60;
  const hour = Math.floor(hours), minute = Math.floor(minutes % 60);
  const daylight = smooth(5.75, 7.25, hours) * (1 - smooth(18.75, 20.25, hours));
  const night = 1 - daylight;
  const twilight = 1 - Math.abs(daylight * 2 - 1);
  const phase = daylight > .94 ? 'jour' : daylight < .06 ? 'nuit' : hours < 12 ? 'aurore' : 'crépuscule';
  return { hour, minute, hours, label: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    phase, daylight, night, twilight, sunAngle: (hours - 6) / 14 * Math.PI,
    day: Math.floor(total / 1440) + 1 };
}
