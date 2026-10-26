export const MIN = 60000;
export const DAY_MS = 864e5;
export const WORK_START = 9 * 60;
export const WORK_END = 21 * 60;
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type DateLike = Date | number | string;

export const pad = (n: number) => String(n).padStart(2, '0');
export const startOfDay = (d: DateLike) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d: DateLike, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const ymd = (d: DateLike) => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
export const fromYmd = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const minsOf = (d: DateLike) => { const x = new Date(d); return x.getHours() * 60 + x.getMinutes(); };
export const atMinutes = (day: DateLike, mins: number) => { const x = startOfDay(day); x.setMinutes(mins); return x.getTime(); };
export const ceil15 = (ms: number) => {
  const d = new Date(ms);
  const extra = (d.getMinutes() % 15) * MIN + d.getSeconds() * 1000 + d.getMilliseconds();
  return extra ? ms - extra + 15 * MIN : ms;
};
export const endOf = (t: { start: number | null; minutes: number }) => (t.start ?? 0) + t.minutes * MIN;
/** Monday of the week containing d. */
export const weekStart = (d: DateLike) => addDays(startOfDay(d), -((new Date(d).getDay() + 6) % 7));
