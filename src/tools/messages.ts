/**
 * What the agent says, in the institution's own language.
 *
 * The runbook sells this as a differentiator: "the same server answers in Spanish in Madrid and in
 * English in Dublin". Dates already did — `Intl` handles those from the declared locale — but the
 * sentences around them were English regardless, which is worse than not translating at all: it
 * reads as a translation someone forgot to finish.
 *
 * Messages are **functions, not templates with holes**. Word order, agreement and plurals differ
 * between languages, and a format string with `{count}` in it quietly assumes they do not. A
 * function can put the number where the sentence needs it and pick the right noun.
 *
 * What is *not* translated: anything the institution wrote. Room ids, equipment names, course
 * codes, deadline labels and the building names in a route all come from its own data, and
 * translating them would invent vocabulary its students do not use.
 */

import type { IssueStatus, RoomKind } from '../provider/index.ts';

export type Language = 'en' | 'es';

/** `es-ES` → `es`. Anything we do not speak falls back to English. */
export function languageOf(locale: string): Language {
  const primary = locale.toLowerCase().split('-')[0];
  return primary === 'es' ? 'es' : 'en';
}

export interface Messages {
  readonly roomKind: Readonly<Record<RoomKind, string>>;
  readonly issueStatus: Readonly<Record<IssueStatus, string>>;

  /** `MEN-301, study room, seats 60` */
  describeRoom(id: string, kind: string, capacity: number): string;
  freeRooms(until: string, shortlist: readonly string[], more: number): string;
  noFreeRooms(building: string | null, until: string): string;
  windowBackwards(): string;

  timetableEmpty(day: string): string;
  timetable(day: string, lines: readonly string[]): string;
  session(time: string, course: string, room: string, group?: string): string;

  noDeadlineAbout(topic: string): string;
  noDeadlinesAtAll(): string;
  deadlineClosed(label: string, day: string): string;
  deadlineToday(label: string): string;
  deadlineLeft(label: string, day: string, days: number): string;

  unknownPlace(place: string): string;

  confirmFault(equipment: string, room: string): string;

  /** One room's diary. `until`/`from` are already formatted in the institution's clock. */
  roomFreeAllDay(room: string): string;
  roomFreeUntil(room: string, until: string): string;
  roomTakenUntil(room: string, until: string, by?: string): string;
  roomTakenAllDay(room: string): string;
  /** A booking asked for a time already gone today. */
  alreadyPast(at: string): string;
  /** What follows a taken slot: the gap, or the rest of the day. */
  thenFreeUntil(until: string): string;
  thenFreeAllDay(): string;
  /** Booking, in two turns like a fault report. */
  confirmBooking(room: string, at: string, minutes: number): string;
  booked(room: string, at: string, reference: string): string;
  faultFiled(reference: string, equipment: string, room: string): string;
  noSuchRoom(room: string): string;
  roomHasNoSuch(room: string, equipment: string, actual: readonly string[]): string;

  noReports(): string;
  report(reference: string, equipment: string, room: string, status: string): string;

  mustSignIn(): string;
  notOnRecord(kind: string, ref: string): string;

  /** Card labels. Cards are an improvement on the spoken answer, never a replacement. */
  readonly card: {
    occupancyTitle(building: string | null): string;
    occupancySubtitle(free: number, total: number, until: string): string;
    floorTitle(building: string, floor: number): string;
    floorSubtitle(roomId: string): string;
    issueTitle(): string;
    room: string;
    equipment: string;
    status: string;
    reported: string;
  };
}

const english: Messages = {
  roomKind: {
    lecture: 'lecture hall',
    seminar: 'seminar room',
    lab: 'laboratory',
    'computer-lab': 'computer lab',
    study: 'study room',
    auditorium: 'auditorium',
  },
  issueStatus: { open: 'open', 'in-progress': 'in progress', resolved: 'resolved' },

  describeRoom: (id, kind, capacity) => `${id}, ${kind}, seats ${capacity}`,
  freeRooms: (until, shortlist, more) =>
    `Free from now until ${until}: ${shortlist.join('; ')}.` +
    (more > 0 ? ` And ${more} more.` : ''),
  // "until 18:00" reads two ways: nothing free in that window, or nothing free *before* then.
  // A real model read it the second way and told a student the room frees up at a time it does
  // not. Naming both ends of the window removes the reading that is wrong.
  noFreeRooms: (building, until) =>
    building
      ? `Nothing free in ${building} between now and ${until}.`
      : `Nothing free between now and ${until}.`,
  windowBackwards: () => 'That time window ends before it starts.',

  timetableEmpty: (day) => `Nothing on ${day}.`,
  timetable: (day, lines) => `${day}: ${lines.join('; ')}.`,
  session: (time, course, room, group) =>
    group ? `${time} ${course}, group ${group}, in ${room}` : `${time} ${course}, in ${room}`,

  noDeadlineAbout: (topic) =>
    `I have nothing on record about ${topic}. Worth checking with the registry.`,
  noDeadlinesAtAll: () => 'I have no deadlines on record.',
  deadlineClosed: (label, day) => `${label} — closed, ${day}`,
  deadlineToday: (label) => `${label} — today`,
  deadlineLeft: (label, day, days) =>
    `${label} — ${day}, ${days} day${days === 1 ? '' : 's'} left`,

  unknownPlace: (place) => `I do not know a place called ${place}.`,

  confirmFault: (equipment, room) => `File a fault for the ${equipment} in ${room}?`,
  roomFreeAllDay: (room) => `${room} is free all day.`,
  roomFreeUntil: (room, until) => `${room} is free until ${until}.`,
  roomTakenUntil: (room, until, by) =>
    by ? `${room} is taken until ${until}, with ${by}. ` : `${room} is taken until ${until}. `,
  roomTakenAllDay: (room) => `${room} is taken for the rest of the day.`,
  alreadyPast: (at) => `${at} has already gone today. I can only hold a room from now on.`,
  thenFreeUntil: (until) => `After that it is free until ${until}.`,
  thenFreeAllDay: () => 'After that it is free for the rest of the day.',
  confirmBooking: (room, at, minutes) => `Shall I hold ${room} at ${at} for ${minutes} minutes?`,
  booked: (room, at, reference) => `Done. ${room} is yours at ${at}. The reference is ${reference}.`,
  faultFiled: (reference, equipment, room) =>
    `Filed. The reference is ${reference}, for the ${equipment} in ${room}.`,
  noSuchRoom: (room) => `I have no room called ${room}.`,
  roomHasNoSuch: (room, equipment, actual) =>
    `${room} has no ${equipment}. It has: ${actual.join(', ')}.`,

  noReports: () => 'You have not reported anything.',
  report: (reference, equipment, room, status) =>
    `${reference}, ${equipment} in ${room}, ${status}`,

  mustSignIn: () => 'You need to be signed in for that.',
  notOnRecord: (kind, ref) => `I have no ${kind} on record for ${ref}.`,

  card: {
    occupancyTitle: (building) => (building ? `Rooms in ${building}` : 'Rooms across campus'),
    occupancySubtitle: (free, total, until) =>
      `${free} of ${total} free until ${until}`,
    floorTitle: (building, floor) =>
      floor === 0 ? `${building}, ground floor` : `${building}, floor ${floor}`,
    floorSubtitle: (roomId) => `${roomId} is marked`,
    issueTitle: () => 'Reported fault',
    room: 'Room',
    equipment: 'Equipment',
    status: 'Status',
    reported: 'Reported',
  },
};

const spanish: Messages = {
  roomKind: {
    lecture: 'aula magna',
    seminar: 'seminario',
    lab: 'laboratorio',
    'computer-lab': 'aula de informática',
    study: 'sala de estudio',
    auditorium: 'auditorio',
  },
  issueStatus: { open: 'abierto', 'in-progress': 'en curso', resolved: 'resuelto' },

  describeRoom: (id, kind, capacity) => `${id}, ${kind}, ${capacity} plazas`,
  freeRooms: (until, shortlist, more) =>
    `Libres de aquí a las ${until}: ${shortlist.join('; ')}.` +
    // "y una más" / "y 3 más": the number is not always a number in Spanish.
    (more === 1 ? ' Y una más.' : more > 1 ? ` Y ${more} más.` : ''),
  // Ver la nota en la version inglesa: "hasta las 08:15" se leyo como "libre a partir de las
  // 08:15", que es justo lo contrario de lo que queriamos decir.
  noFreeRooms: (building, until) =>
    building
      ? `No hay nada libre en ${building} de aquí a las ${until}.`
      : `No hay nada libre de aquí a las ${until}.`,
  windowBackwards: () => 'Ese intervalo termina antes de empezar.',

  timetableEmpty: (day) => `No tienes nada el ${day}.`,
  timetable: (day, lines) => `El ${day}: ${lines.join('; ')}.`,
  session: (time, course, room, group) =>
    group ? `${time} ${course}, grupo ${group}, en ${room}` : `${time} ${course}, en ${room}`,

  noDeadlineAbout: (topic) =>
    `No me consta nada sobre ${topic}. Conviene consultarlo en secretaría.`,
  noDeadlinesAtAll: () => 'No me consta ningún plazo.',
  deadlineClosed: (label, day) => `${label} — cerrado, ${day}`,
  deadlineToday: (label) => `${label} — hoy`,
  // "queda 1 día" / "quedan 3 días": the verb agrees with the number, which a template cannot do.
  deadlineLeft: (label, day, days) =>
    days === 1 ? `${label} — ${day}, queda 1 día` : `${label} — ${day}, quedan ${days} días`,

  unknownPlace: (place) => `No conozco ningún sitio llamado ${place}.`,

  confirmFault: (equipment, room) => `¿Abro un aviso por ${equipment} en ${room}?`,
  roomFreeAllDay: (room) => `${room} está libre todo el día.`,
  roomFreeUntil: (room, until) => `${room} está libre hasta las ${until}.`,
  roomTakenUntil: (room, until, by) =>
    by ? `${room} está ocupada hasta las ${until}, con ${by}. ` : `${room} está ocupada hasta las ${until}. `,
  roomTakenAllDay: (room) => `${room} está ocupada el resto del día.`,
  alreadyPast: (at) => `Las ${at} ya han pasado hoy. Solo puedo reservar de ahora en adelante.`,
  thenFreeUntil: (until) => `Después queda libre hasta las ${until}.`,
  thenFreeAllDay: () => 'Después queda libre el resto del día.',
  confirmBooking: (room, at, minutes) => `¿Reservo ${room} a las ${at} durante ${minutes} minutos?`,
  booked: (room, at, reference) => `Hecho. ${room} es tuya a las ${at}. La referencia es ${reference}.`,
  faultFiled: (reference, equipment, room) =>
    `Hecho. La referencia es ${reference}, por ${equipment} en ${room}.`,
  noSuchRoom: (room) => `No tengo ningún aula llamada ${room}.`,
  roomHasNoSuch: (room, equipment, actual) =>
    `${room} no tiene ${equipment}. Tiene: ${actual.join(', ')}.`,

  noReports: () => 'No has dado ningún aviso.',
  report: (reference, equipment, room, status) =>
    `${reference}, ${equipment} en ${room}, ${status}`,

  mustSignIn: () => 'Para eso tienes que identificarte.',
  notOnRecord: (kind, ref) => `No me consta ningún ${kind} con ${ref}.`,

  card: {
    occupancyTitle: (building) => (building ? `Aulas de ${building}` : 'Aulas del campus'),
    occupancySubtitle: (free, total, until) =>
      // "1 libre" / "3 libres": otra concordancia que una plantilla no resuelve.
      free === 1
        ? `1 libre de ${total} hasta las ${until}`
        : `${free} libres de ${total} hasta las ${until}`,
    floorTitle: (building, floor) =>
      floor === 0 ? `${building}, planta baja` : `${building}, planta ${floor}`,
    floorSubtitle: (roomId) => `${roomId} está señalado`,
    issueTitle: () => 'Aviso registrado',
    room: 'Aula',
    equipment: 'Equipo',
    status: 'Estado',
    reported: 'Dado de alta',
  },
};

const CATALOGUE: Readonly<Record<Language, Messages>> = { en: english, es: spanish };

/** The messages for a locale. Unknown locales get English rather than an error. */
export function messagesFor(locale: string): Messages {
  return CATALOGUE[languageOf(locale)];
}
