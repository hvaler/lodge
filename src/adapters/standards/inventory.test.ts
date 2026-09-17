import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { instantAt } from '../../shared/time.ts';
import { InventoryError, loadInventory } from './inventory.ts';

const DUBLIN = 'Europe/Dublin';
const FIXTURES = join(process.cwd(), 'fixtures', 'carrigmore');

/** Writes a one-off CSV so a test can describe exactly the malformation it is about. */
async function withCsv(rooms: string, buildings?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lodge-inv-'));
  const path = join(dir, 'rooms.csv');
  await writeFile(path, rooms, 'utf8');
  if (buildings) await writeFile(join(dir, 'buildings.csv'), buildings, 'utf8');
  return path;
}

const HEADER = 'room_id,building_code,building_name,floor,kind,capacity,equipment,supervised\n';

describe('reading Carrigmore from its tables', () => {
  it('loads the twelve rooms across two buildings', async () => {
    const inventory = await loadInventory({ location: join(FIXTURES, 'rooms.csv') }, DUBLIN);

    expect(inventory.rooms).toHaveLength(12);
    expect(inventory.buildings.map((b) => b.code).sort()).toEqual(['MIL', 'QUA']);
  });

  it('accepts a room numbering that is nothing like San Telmo’s', async () => {
    // QUA-G01 rather than MEN-001. An adapter that only swallowed the synthetic scheme would make
    // the seam fake, which is the whole thing two adapters exist to prevent.
    const inventory = await loadInventory({ location: join(FIXTURES, 'rooms.csv') }, DUBLIN);
    const room = inventory.roomById('QUA-G01');

    expect(room).not.toBeNull();
    expect(room?.building).toBe('QUA');
    expect(room?.floor).toBe(0);
    expect(room?.capacity).toBe(150);
  });

  it('takes the building from its column, not by parsing the id', async () => {
    const path = await withCsv(`${HEADER}WEIRD/ID:7,ANNEXE,The Annexe,1,seminar,20,whiteboard,false\n`);
    const inventory = await loadInventory({ location: path }, DUBLIN);

    expect(inventory.roomById('WEIRD/ID:7')?.building).toBe('ANNEXE');
  });

  it('splits equipment on semicolons, so a spreadsheet stays editable by hand', async () => {
    const inventory = await loadInventory({ location: join(FIXTURES, 'rooms.csv') }, DUBLIN);

    expect(inventory.roomById('QUA-G01')?.equipment).toEqual(['projector', 'screen', 'PA system']);
  });

  it('marks the lab and the computer labs as supervised', async () => {
    const inventory = await loadInventory({ location: join(FIXTURES, 'rooms.csv') }, DUBLIN);
    const supervised = inventory.rooms.filter((r) => r.supervised).map((r) => r.id);

    expect(supervised.sort()).toEqual(['MIL-201', 'QUA-201', 'QUA-202']);
  });

  it('returns null for a room or building it has never heard of', async () => {
    const inventory = await loadInventory({ location: join(FIXTURES, 'rooms.csv') }, DUBLIN);

    expect(inventory.roomById('QUA-999')).toBeNull();
    expect(inventory.buildingByCode('ZZZ')).toBeNull();
  });
});

describe('opening hours', () => {
  it('reads them on the institution’s own clock, not the server’s', async () => {
    const inventory = await loadInventory({ location: join(FIXTURES, 'rooms.csv') }, DUBLIN);

    // Quay House opens 08:00–21:00 Dublin time on weekdays. Tuesday 6 October 2026.
    const inHours = {
      from: instantAt('2026-10-06', '09:00', DUBLIN),
      to: instantAt('2026-10-06', '10:00', DUBLIN),
    };
    const afterClosing = {
      from: instantAt('2026-10-06', '20:30', DUBLIN),
      to: instantAt('2026-10-06', '21:30', DUBLIN),
    };

    expect(inventory.isOpen('QUA', inHours.from, inHours.to)).toBe(true);
    expect(inventory.isOpen('QUA', afterClosing.from, afterClosing.to)).toBe(false);
  });

  it('closes The Mill at the weekend and opens Quay House on Saturday', async () => {
    const inventory = await loadInventory({ location: join(FIXTURES, 'rooms.csv') }, DUBLIN);
    const saturday = {
      from: instantAt('2026-10-10', '11:00', DUBLIN),
      to: instantAt('2026-10-10', '12:00', DUBLIN),
    };

    expect(inventory.isOpen('MIL', saturday.from, saturday.to)).toBe(false);
    expect(inventory.isOpen('QUA', saturday.from, saturday.to)).toBe(true);
  });

  it('treats a building with no table entry as always open, rather than refusing to start', async () => {
    // An institution that has no opening-hours file should still get room search. Wrong-but-honest
    // beats not starting.
    const path = await withCsv(`${HEADER}X-1,XBL,Block X,0,study,10,,false\n`);
    const inventory = await loadInventory({ location: path }, DUBLIN);

    const window = {
      from: instantAt('2026-10-06', '03:00', DUBLIN),
      to: instantAt('2026-10-06', '04:00', DUBLIN),
    };
    expect(inventory.isOpen('XBL', window.from, window.to)).toBe(true);
    expect(inventory.buildingByCode('XBL')?.name).toBe('Block X');
  });
});

describe('rejecting a table an institution got wrong', () => {
  it('names the room with an unknown kind and lists the valid ones', async () => {
    const path = await withCsv(`${HEADER}Q-1,QUA,Quay House,1,classroom,20,,false\n`);

    await expect(loadInventory({ location: path }, DUBLIN)).rejects.toThrow(/Room 'Q-1' has kind 'classroom'/);
    await expect(loadInventory({ location: path }, DUBLIN)).rejects.toThrow(/seminar/);
  });

  it('names the room with a capacity that is not a number of seats', async () => {
    const path = await withCsv(`${HEADER}Q-1,QUA,Quay House,1,seminar,lots,,false\n`);

    await expect(loadInventory({ location: path }, DUBLIN)).rejects.toThrow(/Room 'Q-1' has capacity 'lots'/);
  });

  it('rejects a duplicated room id, which is a table maintained by two people', async () => {
    const path = await withCsv(
      `${HEADER}Q-1,QUA,Quay House,1,seminar,20,,false\nQ-1,QUA,Quay House,2,seminar,25,,false\n`,
    );

    await expect(loadInventory({ location: path }, DUBLIN)).rejects.toThrow(/appears twice/);
  });

  it('rejects a half-filled opening time instead of guessing the other half', async () => {
    const path = await withCsv(
      `${HEADER}Q-1,QUA,Quay House,1,seminar,20,,false\n`,
      'building_code,building_name,opens_mon_fri,closes_mon_fri,opens_sat,closes_sat,opens_sun,closes_sun\nQUA,Quay House,08:00,,,,,\n',
    );

    await expect(loadInventory({ location: path }, DUBLIN)).rejects.toThrow(/only one of/);
  });

  it('rejects a supervised column that is neither true nor false', async () => {
    const path = await withCsv(`${HEADER}Q-1,QUA,Quay House,1,seminar,20,,sometimes\n`);

    await expect(loadInventory({ location: path }, DUBLIN)).rejects.toThrow(/should be true or false/);
  });

  it('rejects an empty table', async () => {
    const path = await withCsv(HEADER);

    await expect(loadInventory({ location: path }, DUBLIN)).rejects.toThrow(InventoryError);
  });

  it('says which file it could not read', async () => {
    await expect(loadInventory({ location: '/no/such/rooms.csv' }, DUBLIN)).rejects.toThrow(
      /\/no\/such\/rooms\.csv/,
    );
  });
});

describe('the rooms written in the configuration file instead of a table', () => {
  // Carrigmore's first three rooms, said twice: once as the institution would write them in the
  // configuration, once as the columns of the CSV that ships in `fixtures/`.
  const INLINE = [
    {
      id: 'QUA-G01',
      building: 'QUA',
      buildingName: 'Quadrangle',
      floor: 0,
      kind: 'lecture',
      capacity: 150,
      equipment: ['projector', 'lectern microphone'],
    },
    {
      id: 'QUA-101',
      building: 'QUA',
      buildingName: 'Quadrangle',
      floor: 1,
      kind: 'seminar',
      capacity: 24,
      equipment: ['whiteboard'],
    },
    { id: 'MIL-004', building: 'MIL', buildingName: 'Mill House', floor: 0, kind: 'study', capacity: 8 },
  ] as const;

  const AS_CSV =
    `${HEADER}` +
    'QUA-G01,QUA,Quadrangle,0,lecture,150,projector;lectern microphone,false\n' +
    'QUA-101,QUA,Quadrangle,1,seminar,24,whiteboard,false\n' +
    'MIL-004,MIL,Mill House,0,study,8,,false\n';

  it('produces exactly the rooms the same table would', async () => {
    // The claim the whole feature rests on: one room model, written two ways. If these ever
    // diverge there are two models and the second one is undocumented.
    const written = await loadInventory({ rooms: INLINE }, DUBLIN);
    const tabulated = await loadInventory({ location: await withCsv(AS_CSV) }, DUBLIN);

    expect(written.rooms).toEqual(tabulated.rooms);
  });

  it('refuses a bad room with the same sentence a table would earn', async () => {
    const broken = [{ ...INLINE[0], capacity: 0 }];

    await expect(loadInventory({ rooms: broken }, DUBLIN)).rejects.toThrow(InventoryError);
    await expect(loadInventory({ rooms: broken }, DUBLIN)).rejects.toThrow(
      /Room 'QUA-G01' has capacity '0', which is not a whole number of seats/,
    );
  });

  it('says where the mistake is, and "the configuration file" is a place', async () => {
    await expect(loadInventory({ rooms: [] }, DUBLIN)).rejects.toThrow(
      /The room table at the configuration file has no rows/,
    );
  });

  it('takes opening hours from the configuration too', async () => {
    const inventory = await loadInventory(
      {
        rooms: INLINE,
        buildings: [{ code: 'QUA', name: 'Quadrangle', weekdays: '08:00-21:00', saturday: '09:00-13:00' }],
      },
      DUBLIN,
    );

    // Thursday 09:00, inside the weekday window; Sunday has no window at all.
    expect(inventory.isOpen('QUA', instantAt('2026-09-17', '09:00', DUBLIN), instantAt('2026-09-17', '10:00', DUBLIN))).toBe(true);
    expect(inventory.isOpen('QUA', instantAt('2026-09-20', '09:00', DUBLIN), instantAt('2026-09-20', '10:00', DUBLIN))).toBe(false);
  });

  it('treats a building with no hours as always open, rather than never', async () => {
    // An institution that writes twelve rooms and no hours has said nothing about closing, and
    // answering "nothing is free, ever" to that silence would be the wrong reading.
    const inventory = await loadInventory({ rooms: INLINE }, DUBLIN);

    expect(inventory.isOpen('MIL', instantAt('2026-09-20', '03:00', DUBLIN), instantAt('2026-09-20', '04:00', DUBLIN))).toBe(true);
    expect(inventory.buildingByCode('MIL')?.name).toBe('Mill House');
  });

  it('says the building code aloud when no name was given', async () => {
    const nameless = [{ ...INLINE[0], buildingName: undefined }];
    const inventory = await loadInventory({ rooms: nameless }, DUBLIN);

    expect(inventory.buildingByCode('QUA')?.name).toBe('QUA');
  });
});
