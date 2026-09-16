/**
 * Wiring the exporter — the part that costs something, and therefore the part that is opt-in.
 *
 * An institution that sets `OTEL_EXPORTER_OTLP_ENDPOINT` gets traces. One that does not gets a
 * server that starts no exporter, opens no connection and loads none of this code: the SDK is
 * imported dynamically, so the thirteen packages behind it are never touched on a deployment that
 * has not asked for them.
 *
 * The standard alternative works too and is documented rather than duplicated: running Node with
 * `--import` and your own SDK bootstrap registers a provider, and the spans in `telemetry/index.ts`
 * find it without this file being involved at all. That is the idiomatic pattern for a library, and
 * Lodge is both a library and a server — this file exists so the server half works out of the box.
 */

export interface Telemetry {
  /** Flushes what is buffered. Called on shutdown so the last trace of a run is not lost. */
  shutdown(): Promise<void>;
}

/** Where traces go. Absent means none are exported, which is the default. */
export function otlpEndpointFrom(env: NodeJS.ProcessEnv): string | null {
  return env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] ?? null;
}

/**
 * Starts exporting, if this deployment asked for it.
 *
 * Returns `null` when it did not, which is a normal outcome and not a failure: a server that
 * refused to start because nobody configured a collector would be a worse server.
 */
export async function startTelemetry(
  env: NodeJS.ProcessEnv = process.env,
  serviceName = 'lodge',
): Promise<Telemetry | null> {
  if (!otlpEndpointFrom(env)) return null;

  // Imported here rather than at the top so a deployment without a collector never loads the SDK.
  const [{ NodeTracerProvider, BatchSpanProcessor }, { OTLPTraceExporter }, { resourceFromAttributes }, semconv] =
    await Promise.all([
      import('@opentelemetry/sdk-trace-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/semantic-conventions'),
    ]);

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [semconv.ATTR_SERVICE_NAME]: serviceName,
      [semconv.ATTR_SERVICE_VERSION]: '0.0.0',
    }),
    // Batched, never synchronous. Waiting on a collector inside a request would spend the latency
    // budget on telemetry about the latency budget.
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter())],
  });

  provider.register();

  return {
    async shutdown() {
      await provider.shutdown();
    },
  };
}
