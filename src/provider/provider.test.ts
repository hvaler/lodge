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

  it.each(CAPABILITIES)('accepts %s declared on its own', (capability) => {
    expect(() => assertProviderCoherent(providerFor([capability]))).not.toThrow();
  });

  it('rejects a capability that is declared but not implemented', () => {
    // Arrange: declares `issues` but the methods were never attached.
    const provider = { descriptor: descriptorFor(['issues']) } as unknown as Provider;

    // Act & Assert
    expect(() => assertProviderCoherent(provider)).toThrow(ProviderContractError);
    expect(() => assertProviderCoherent(provider)).toThrow(/declares capability 'issues'/);
  });

  it('rejects a method that is implemented but not declared', () => {
    // An undeclared method is unreachable: no tool publishes it. Silent dead code in an adapter
    // is exactly the drift the capability negotiation is supposed to prevent.
    const provider = {
      descriptor: descriptorFor(['rooms']),
      findFreeRooms: noop,
      getRoom: noop,
      reportIssue: noop,
      issueStatus: noop,
    } as unknown as Provider;

    expect(() => assertProviderCoherent(provider)).toThrow(/does not declare capability 'issues'/);
  });

  it('rejects a provider that declares nothing, since it would publish no tools', () => {
    const provider = { descriptor: descriptorFor([]) } as unknown as Provider;

    expect(() => assertProviderCoherent(provider)).toThrow(/declares no capabilities/);
  });
});

describe('toolCatalogue', () => {
  it('publishes only the tools of the declared capabilities', () => {
    // An institution with no issue tracker: the agent must never offer to file a fault.
    const catalogue = toolCatalogue(providerFor(['rooms', 'timetable', 'deadlines']));

    expect(catalogue).toEqual(['campus.find_room', 'campus.timetable', 'campus.deadlines']);
    expect(catalogue).not.toContain('campus.report_issue');
    expect(catalogue).not.toContain('campus.issue_status');
  });

  it('publishes all six tools when every capability is declared', () => {
    const catalogue = toolCatalogue(providerFor([...CAPABILITIES]));

    expect([...catalogue].sort()).toEqual([
      'campus.deadlines',
      'campus.find_room',
      'campus.issue_status',
      'campus.report_issue',
      'campus.timetable',
      'campus.wayfind',
    ]);
  });

  it('covers the six tools of the runbook across the capability map, with no duplicates', () => {
    const all = Object.values(CAPABILITY_TOOLS).flat();

    expect(all).toHaveLength(6);
    expect(new Set(all).size).toBe(6);
  });
});
