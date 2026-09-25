import { HDate, HebrewCalendar, Locale, flags, getSedra, gematriya, type Event } from '@hebcal/core';
import { addDays } from './dates';

const IL = true; // Israel schedule (one-day Yom Tov, Israeli parsha order)
// vowel points and cantillation, but keep maqaf (U+05BE) and punctuation
const NIKUD = /[\u0591-\u05BD\u05BF\u05C1\u05C2\u05C4\u05C5\u05C7]/g;

// hebcal uses classic spelling; show the spelling people are used to
const SPELLING: [RegExp, string][] = [
  [/סכות/g, 'סוכות'],
  [/יום כפור/g, 'יום כיפור'],
  [/כי־תצא/g, 'כי תצא'],
  [/כי־תבוא/g, 'כי תבוא'],
  [/שלח־לך/g, 'שלח'],
  [/(^|\s|־)מצרע($|\s|־)/g, '$1מצורע$2'],
  [/(^|\s|־)קדשים($|\s|־)/g, '$1קדושים$2'],
  [/(^|\s|־)בחקתי($|\s|־)/g, '$1בחוקותי$2'],
  [/(^|\s|־)בהעלתך($|\s|־)/g, '$1בהעלותך$2'],
  [/(^|\s|־)קרח($|\s|־)/g, '$1קורח$2'],
  [/(^|\s|־)חקת($|\s|־)/g, '$1חוקת$2'],
  [/(^|\s|־)תצוה($|\s|־)/g, '$1תצווה$2'],
];

export const clean = (s: string) => {
  let r = s.replace(NIKUD, '').replace(/\s+\d{4}$/, '').replace(/\s+/g, ' ').trim();
  for (const [re, to] of SPELLING) r = r.replace(re, to);
  return r;
};

function he(key: string) {
  return clean(Locale.gettext(key, 'he'));
}

/** "י״ד תשרי תשפ״ז" */
export function hebDate(d: Date): string {
  return clean(new HDate(d).renderGematriya(true));
}

/** "י״ד תשרי" */
export function hebDayMonth(d: Date): string {
  const hd = new HDate(d);
  return `${gematriya(hd.getDate())} ${he(hd.getMonthName())}`;
}

/** "י״ד" */
export function hebDay(d: Date): string {
  return gematriya(new HDate(d).getDate());
}

export type DayEvent = { name: string; short: string; chag: boolean; erev: boolean; cholHamoed: boolean; fast: boolean };

function baseName(e: Event): string {
  const b = (e as Event & { basename?: () => string }).basename?.();
  return b ? he(b) : clean(e.render('he'));
}

const SKIP = flags.MODERN_HOLIDAY | flags.SPECIAL_SHABBAT | flags.DAILY_LEARNING | flags.OMER_COUNT | flags.SHABBAT_MEVARCHIM | flags.MOLAD | flags.YOM_KIPPUR_KATAN;

export function dayEvents(d: Date): DayEvent[] {
  const evs: Event[] = HebrewCalendar.getHolidaysOnDate(new HDate(d), IL) ?? [];
  return evs
    .filter((e) => !(e.getFlags() & SKIP))
    .map((e) => {
      const f = e.getFlags();
      const name = clean(e.render('he'));
      let short = name;
      if (name.startsWith('חנוכה')) short = 'חנוכה';
      else if (/הושענא רבה/.test(name)) short = 'הושענא רבה';
      else if (f & flags.CHOL_HAMOED) short = `חול המועד ${baseName(e)}`;
      return {
        name,
        short,
        chag: !!(f & flags.CHAG),
        erev: !!(f & flags.EREV),
        cholHamoed: !!(f & flags.CHOL_HAMOED),
        fast: !!(f & (flags.MAJOR_FAST | flags.MINOR_FAST)),
      };
    });
}

export type WeekInfo = {
  /** "פרשת ויחי" or, when Shabbat is a festival, "סוכות א׳" / "שבת חול המועד פסח" */
  title: string;
  isChag: boolean;
  /** "ט׳–ט״ו תשרי" */
  hebRange: string;
  /** notable days inside the week, e.g. { day: 1, name: 'יום כיפור' } */
  notes: { day: number; name: string; chag: boolean }[];
};

const cache = new Map<number, WeekInfo>();

export function weekInfo(weekStart: Date): WeekInfo {
  const key = weekStart.getTime();
  const hit = cache.get(key);
  if (hit) return hit;

  const sat = addDays(weekStart, 6);
  const hSat = new HDate(sat);
  const sedra = getSedra(hSat.getFullYear(), IL).lookup(hSat);
  let title: string;
  if (!sedra.chag) {
    title = `פרשת ${sedra.parsha.map(he).join('־')}`;
  } else {
    const evs: Event[] = HebrewCalendar.getHolidaysOnDate(hSat, IL) ?? [];
    const main = evs.find((e) => e.getFlags() & (flags.CHAG | flags.CHOL_HAMOED)) ?? evs[0];
    if (main && main.getFlags() & flags.CHOL_HAMOED) {
      title = `שבת חול המועד ${baseName(main)}`;
    } else {
      title = main ? clean(main.render('he')) : he(sedra.parsha[0]);
    }
  }

  const first = new HDate(weekStart);
  const last = hSat;
  const hebRange =
    first.getMonth() === last.getMonth()
      ? `${gematriya(first.getDate())}–${gematriya(last.getDate())} ${he(last.getMonthName())}`
      : `${hebDayMonth(weekStart)} – ${hebDayMonth(sat)}`;

  const notes: WeekInfo['notes'] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 7; i++) {
    for (const e of dayEvents(addDays(weekStart, i))) {
      if (i === 6 && sedra.chag && (e.chag || e.cholHamoed)) continue; // already the title
      if (!(e.chag || e.erev || e.fast || e.cholHamoed || /פורים|חנוכה/.test(e.name))) continue;
      if (seen.has(e.short) || e.short === title || title.endsWith(e.short.replace('חול המועד ', ''))) continue;
      seen.add(e.short);
      notes.push({ day: i, name: e.short, chag: e.chag });
    }
  }

  const info = { title, isChag: sedra.chag, hebRange, notes };
  cache.set(key, info);
  return info;
}

/** "אלול – תשרי תשפ״ז" for a Gregorian month */
export function hebMonthsOf(year: number, month: number): string {
  const a = new HDate(new Date(year, month, 1));
  const b = new HDate(new Date(year, month + 1, 0));
  const ma = he(a.getMonthName());
  const mb = he(b.getMonthName());
  const yb = clean(gematriya(b.getFullYear()));
  if (ma === mb) return `${ma} ${yb}`;
  return a.getFullYear() === b.getFullYear() ? `${ma}–${mb} ${yb}` : `${ma} ${clean(gematriya(a.getFullYear()))} – ${mb} ${yb}`;
}
