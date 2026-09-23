import { describe, expect, it } from 'vitest';

import {
  CAPABILITIES,
  CAPABILITY_METHODS,
  CAPABILITY_TOOLS,
  ProviderContractError,
  assertProviderCoherent,
  toolCatalogue,
} from './provider.ts';
import type { Capability, Provider, ProviderDescriptor } from './provider.ts';

const noop = async (): Promise<never> => {
  throw new Error('not called');
};

function descriptorFor(capabilities: readonly Capability[]): ProviderDescriptor {
  return {
    id: 'fixture',
    institution: 'Fixture University',
    locale: 'en-GB',
    timeZone: 'Europe/London',
    capabilities,
  };
}

/** A provider that declares the given capabilities and implements exactly their methods. */
function providerFor(capabilities: readonly Capability[]): Provider {
  const provider: Record<string, unknown> = { descriptor: descriptorFor(capabilities) };
  for (const capability of capabilities) {
    for (const method of CAPABILITY_METHODS[capability]) provider[method] = noop;
  }
  return provider as unknown as Provider;
}

describe('assertProviderCoherent', () => {
  it('accepts a provider whose declared capabilities match its methods', () => {
    expect(() => assertProviderCoherent(providerFor([...CAPABILITIES]))).not.toThrow();
  });

  // Every capability stands alone except the one that depends on another, which has its own
  // block below. Listing the exception here rather than filtering silently keeps the test honest
  // about what it is not covering.
  const NEEDS_ANOTHER = ['room-availability', 'issue-reporting', 'room-booking'];
  const STANDALONE = CAPABILITIES.filter((c) => !NEEDS_ANOTHER.includes(c));

  it.each(STANDALONE)('accepts %s declared on its own', (capability) => {
    expect(() => assertProviderCoherent(providerFor([capability]))).not.toThrow();
  });

  it('rejects a capability that is declared but not implemented', () => {
    // Arrange: declares `issue-tracking` but the method was never attached.
    const provider = { descriptor: descriptorFor(['issue-tracking']) } as unknown as Provider;

    // Act & Assert
    expect(() => assertProviderCoherent(provider)).toThrow(ProviderContractError);
    expect(() => assertProviderCoherent(provider)).toThrow(/declares capability 'issue-tracking'/);
  });

  it('rejects a method that is implemented but not declared', () => {
    // An undeclared method is unreachable: no tool publishes it. Silent dead code in an adapter
    // is exactly the drift the capability negotiation is supposed to prevent.
    const provider = {
      descriptor: descriptorFor(['room-inventory']),
      getRoom: noop,
      listRooms: noop,
      issueStatus: noop,
    } as unknown as Provider;

    expect(() => assertProviderCoherent(provider)).toThrow(
      /does not declare capability 'issue-tracking'/,
    );
  });

  describe('what stands on knowing which rooms exist', () => {
    it('refuses issue-reporting without the room table, naming what is missing', () => {
      // The tool validates the room and its equipment before asking anyone to confirm. Without it
      // the tool would throw on its first call, and a configuration mistake would surface as a
      // broken conversation rather than as a server that refused to start.
      const provider = providerFor(['issue-reporting']);

      expect(() => assertProviderCoherent(provider)).toThrow(ProviderContractError);
      expect(() => assertProviderCoherent(provider)).toThrow(
        /declares 'issue-reporting', which needs 'room-inventory' as well/,
      );
    });

    it('refuses room-availability without it either, since the card shows the whole grid', () => {
      expect(() => assertProviderCoherent(providerFor(['room-availability']))).toThrow(
        /needs 'room-inventory' as well/,
      );
    });

    it('lets an institution take fault reports with a room list and no timetable at all', () => {
      // ADR-019, and the reason the split was worth another amendment: a room list and a service
      // desk are enough to report a broken projector. Requiring occupancy as well tied the two
      // together for no reason anybody would defend out loud.
      const provider = providerFor(['room-inventory', 'issue-reporting']);

      expect(() => assertProviderCoherent(provider)).not.toThrow();
      expect(toolCatalogue(provider)).toEqual(['campus.report_issue']);
      expect(toolCatalogue(provider)).not.toContain('campus.find_room');
    });

    it('lets an institution take reports without being able to chase them', () => {
      // The other split: a service desk reached by email can receive a fault and cannot answer
      // "how is mine going". It publishes one tool, not two.
      const provider = providerFor(['room-inventory', 'issue-reporting']);

      expect(toolCatalogue(provider)).toContain('campus.report_issue');
      expect(toolCatalogue(provider)).not.toContain('campus.issue_status');
    });
  });

  it('rejects a provider that declares nothing, since it would publish no tools', () => {
    const provider = { descriptor: descriptorFor([]) } as unknown as Provider;

    expect(() => assertProviderCoherent(provider)).toThrow(/declares no capabilities/);
  });
});

describe('toolCatalogue', () => {
  it('publishes only the tools of the declared capabilities', () => {
    // An institution with no issue tracker at all: the agent must never offer to file a fault.
    const catalogue = toolCatalogue(
      providerFor(['room-inventory', 'room-availability', 'timetable', 'deadlines']),
    );

    expect(catalogue).toEqual([
      'campus.find_room',
      'campus.room_schedule',
      'campus.timetable',
      'campus.deadlines',
    ]);
    expect(catalogue).not.toContain('campus.report_issue');
    expect(catalogue).not.toContain('campus.issue_status');
  });

  it('publishes all eight tools when every capability is declared', () => {
    const catalogue = toolCatalogue(providerFor([...CAPABILITIES]));

    expect([...catalogue].sort()).toEqual([
      'campus.book_room',
      'campus.deadlines',
      'campus.find_room',
      'campus.issue_status',
      'campus.report_issue',
      'campus.room_schedule',
      'campus.timetable',
      'campus.wayfind',
    ]);
  });

  it('covers every tool across the capability map, with no duplicates', () => {
    const all = Object.values(CAPABILITY_TOOLS).flat();

    expect(all).toHaveLength(8);
    expect(new Set(all).size).toBe(8);
  });
});
