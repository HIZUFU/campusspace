const hour = 60 * 60 * 1000;
export const slotMs = hour / 2;
export const dayMs = 24 * hour;
export const timezone = 'Asia/Yekaterinburg';
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: timezone });
const hourFormat = new Intl.DateTimeFormat('ru-RU', {
  timeZone: timezone, hour: '2-digit', minute: '2-digit'
});

export function campusDate(time = Date.now()) {
  return dateFormat.format(time);
}

export function hoursFor(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return null;
  const open = Date.parse(date + 'T08:00:00+05:00');
  if (!Number.isFinite(open) || campusDate(open) !== date) return null;
  return { open, close: open + 14 * hour };
}

export function iso(time) {
  return new Date(time).toISOString();
}

export function daySlots(date, reservations, now = Date.now()) {
  const { open, close } = hoursFor(date);
  const slots = [];
  for (let start = open; start < close; start += slotMs) {
    const startAt = iso(start);
    const endAt = iso(start + slotMs);
    const busy = reservations.some(booking => booking.start_at < endAt && booking.end_at > startAt);
    slots.push({
      startAt, endAt, label: hourFormat.format(start),
      status: busy ? 'busy' : start <= now ? 'past' : 'free'
    });
  }
  return slots;
}
