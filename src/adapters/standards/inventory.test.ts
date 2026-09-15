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
