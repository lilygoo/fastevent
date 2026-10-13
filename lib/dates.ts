export function todayEastern(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function easternClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: values.weekday,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function isTradingSession(now = new Date()) {
  const { weekday, minutes } = easternClock(now);
  return !["Sat", "Sun"].includes(weekday) && minutes >= 9 * 60 + 30 && minutes <= 16 * 60;
}

export function isDailyBarFinal(date: string, now = new Date()) {
  const today = todayEastern(now);
  if (date < today) return true;
  if (date > today) return false;
  const { weekday, minutes } = easternClock(now);
  return !["Sat", "Sun"].includes(weekday) && minutes >= 16 * 60 + 15;
}
