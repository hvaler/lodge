import { describe, expect, it } from 'vitest';

import { languageOf, messagesFor } from './messages.ts';
import type { Language } from './messages.ts';

describe('choosing a language', () => {
  it.each([
    ['es-ES', 'es'],
    ['es-MX', 'es'],
    ['ES', 'es'],
    ['en-IE', 'en'],
    ['en-GB', 'en'],
  ])('reads %s as %s', (locale, language) => {
    expect(languageOf(locale)).toBe(language);
  });

  it('falls back to English for a language we do not speak', () => {
    // Better a language the listener may not want than a crash, or half a sentence.
    expect(languageOf('fi-FI')).toBe('en');
    expect(messagesFor('fi-FI').noReports()).toBe('You have not reported anything.');
  });
});

describe('the two catalogues stay in step', () => {
  const en = messagesFor('en-IE');
  const es = messagesFor('es-ES');

  it('answers every message in both languages', () => {
    // A missing translation is a compile error because Messages is a total interface. This checks
    // the other half: that nothing was translated to the empty string to make it compile.
    for (const [key, value] of Object.entries(es)) {
      if (typeof value === 'function') continue;
      for (const [kind, word] of Object.entries(value as Record<string, string>)) {
        expect(word.trim(), `es.${key}.${kind}`).not.toBe('');
      }
    }
  });

  it('translates the vocabulary Lodge owns', () => {
    expect(es.roomKind.study).toBe('sala de estudio');
    expect(en.roomKind.study).toBe('study room');
    expect(es.issueStatus['in-progress']).toBe('en curso');
  });
});

describe('agreement, which a template with holes cannot do', () => {
  const es = messagesFor('es-ES');
  const en = messagesFor('en-IE');

  it('agrees the verb with the number of days in Spanish', () => {
    expect(es.deadlineLeft('Matrícula', 'viernes', 1)).toContain('queda 1 día');
    expect(es.deadlineLeft('Matrícula', 'viernes', 3)).toContain('quedan 3 días');
  });

  it('pluralises the noun in English', () => {
    expect(en.deadlineLeft('Enrolment', 'Friday', 1)).toContain('1 day left');
    expect(en.deadlineLeft('Enrolment', 'Friday', 3)).toContain('3 days left');
  });

  it('says "una más" rather than "1 más"', () => {
    expect(es.freeRooms('18:00', ['MEN-301'], 1)).toContain('Y una más.');
    expect(es.freeRooms('18:00', ['MEN-301'], 3)).toContain('Y 3 más.');
    expect(es.freeRooms('18:00', ['MEN-301'], 0)).not.toContain('más');
  });

  it('omits the group when the institution has none', () => {
    expect(es.session('10:00', 'CS101', 'QUA-101')).toBe('10:00 CS101, en QUA-101');
    expect(es.session('10:00', 'DER-201', 'MEN-201', 'A')).toBe('10:00 DER-201, grupo A, en MEN-201');
  });
});

describe('what is never translated', () => {
  const es = messagesFor('es-ES');

  it('leaves the institution’s own words alone', () => {
    // Equipment names, room ids and deadline labels come from its data. Translating them would
    // invent vocabulary its own students do not use.
    expect(es.roomHasNoSuch('MEN-301', 'projector', ['whiteboard', 'power at every seat'])).toContain(
      'whiteboard',
    );
    expect(es.deadlineClosed('Registration closes', 'viernes')).toContain('Registration closes');
  });
});
