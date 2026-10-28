const AMMAN_TIME_ZONE = 'Asia/Amman';
const AMMAN_OFFSET_MS = 3 * 60 * 60 * 1000;

const ammanDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: AMMAN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getAmmanDateParts(now) {
  const parts = Object.fromEntries(
    ammanDateFormatter.formatToParts(now)
      .filter(({ type }) => ['year', 'month', 'day'].includes(type))
      .map(({ type, value }) => [type, Number(value)]),
  );

  return parts;
}

export function getAmmanDayKey(now = new Date()) {
  const { year, month, day } = getAmmanDateParts(now);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getAmmanNextMidnight(now = new Date()) {
  const { year, month, day } = getAmmanDateParts(now);
  const nextLocalMidnight = Date.UTC(year, month - 1, day + 1);
  return nextLocalMidnight - AMMAN_OFFSET_MS;
}

export function getTimeUntilAmmanReset(now = new Date()) {
  return Math.max(0, getAmmanNextMidnight(now) - now.getTime());
}
