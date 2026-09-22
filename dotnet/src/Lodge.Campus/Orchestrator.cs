using System.Diagnostics;

using Amazon.BedrockRuntime;
using Amazon.BedrockRuntime.Model;

using ModelContextProtocol.Client;

namespace Lodge.Campus;

/// <summary>Quién dijo qué en un turno anterior de la conversación.</summary>
/// <param name="Role"><c>user</c> o <c>assistant</c>.</param>
/// <param name="Text">Lo que se dijo.</param>
public sealed record Turn(string Role, string Text);

/// <summary>Una llamada a herramienta, tal y como ocurrió.</summary>
/// <param name="Step">El orden dentro del intercambio, empezando en 1.</param>
/// <param name="Tool">El nombre MCP de la herramienta.</param>
/// <param name="Output">Lo que devolvió, o el error.</param>
/// <param name="Milliseconds">Lo que tardó.</param>
/// <param name="Failed">Si falló.</param>
public sealed record TraceStep(int Step, string Tool, string Output, double Milliseconds, bool Failed);

/// <summary>Lo que costó un intercambio, en fichas.</summary>
/// <param name="InputTokens">Fichas de entrada facturadas.</param>
/// <param name="OutputTokens">Fichas de salida.</param>
public sealed record Usage(int InputTokens, int OutputTokens);

/// <summary>El resultado de una pregunta.</summary>
/// <param name="Said">Lo que hay que decir en voz alta.</param>
/// <param name="Trace">Las herramientas que se llamaron, en orden.</param>
/// <param name="Elapsed">Lo que tardó el intercambio entero.</param>
/// <param name="Usage">Lo que costó.</param>
public sealed record Exchange(
    string Said,
    IReadOnlyList<TraceStep> Trace,
    TimeSpan Elapsed,
    Usage Usage);

/// <summary>
/// El orquestador: un modelo, un catálogo descubierto por MCP, y un bucle entre los dos.
/// </summary>
/// <remarks>
/// <para>
/// Hace lo mismo que <c>createOrchestrator()</c> en <c>src/orchestrator/index.ts</c>, y se escribe
/// aparte a propósito: el objetivo es demostrar que el camino entero —descubrir, decidir, llamar,
/// hablar— cabe en .NET sin TypeScript de por medio.
/// </para>
/// <para>
/// <b>La traza se devuelve siempre.</b> No es telemetría: es la única forma de que quien mira una
/// demostración distinga «consultó el calendario y calculó» de «se lo ha inventado con buen estilo».
/// </para>
/// </remarks>
public sealed class Orchestrator
{
    /// <summary>El perfil de inferencia por defecto. No el id pelado: Nova 2 Lite no existe en región.</summary>
    public const string DefaultModelId = "eu.amazon.nova-2-lite-v1:0";

    /// <summary>Dónde vive ese perfil.</summary>
    public const string DefaultRegion = "eu-west-1";

    private readonly LodgeClient _lodge;
    private readonly IAmazonBedrockRuntime _bedrock;
    private readonly string _modelId;
    private readonly int _maxRounds;

    /// <summary>Construye un orquestador sobre un servidor y un modelo ya conectados.</summary>
    /// <param name="lodge">El cliente MCP de la institución que va a responder.</param>
    /// <param name="bedrock">El cliente de Bedrock.</param>
    /// <param name="modelId">El perfil de inferencia; por defecto <see cref="DefaultModelId"/>.</param>
    /// <param name="maxRounds">
    /// Cuántas vueltas de «piensa, llama, vuelve a pensar» se permiten. Cuatro basta para las
    /// preguntas del campus y acota lo que puede costar una pregunta rara.
    /// </param>
    public Orchestrator(
        LodgeClient lodge,
        IAmazonBedrockRuntime bedrock,
        string? modelId = null,
        int maxRounds = 4)
    {
        _lodge = lodge ?? throw new ArgumentNullException(nameof(lodge));
        _bedrock = bedrock ?? throw new ArgumentNullException(nameof(bedrock));
        _modelId = modelId ?? DefaultModelId;
        _maxRounds = maxRounds;
    }

    /// <summary>
    /// Bedrock rechaza un nombre de herramienta que no sea <c>[a-zA-Z0-9_-]</c>, y todas las de
    /// Lodge son <c>campus.x</c>.
    /// </summary>
    /// <remarks>
    /// El punto es parte del contrato MCP y no se negocia en ese lado, así que la conversión ocurre
    /// aquí y en ningún otro sitio: el modelo ve <c>campus_find_room</c>, el servidor conserva
    /// <c>campus.find_room</c>, y ninguno tiene que saber de la restricción del otro.
    /// </remarks>
    public static string ToModelName(string mcpName)
    {
        ArgumentNullException.ThrowIfNull(mcpName);
        return mcpName.Replace('.', '_');
    }

    /// <summary>Responde a lo que alguien ha dicho, usando lo que la institución publique.</summary>
    /// <param name="utterance">Lo que se ha preguntado.</param>
    /// <param name="institution">Cómo se llama la institución, para que el modelo sepa quién es.</param>
    /// <param name="locale">En qué idioma contestar.</param>
    /// <param name="history">Turnos anteriores, si los hay. Es lo que permite confirmar en dos vueltas.</param>
    /// <param name="cancellationToken">Para abandonar.</param>
    public async Task<Exchange> AskAsync(
        string utterance,
        string institution,
        string locale,
        IReadOnlyList<Turn>? history = null,
        CancellationToken cancellationToken = default)
    {
        var clock = Stopwatch.StartNew();

        var catalogue = await _lodge.CatalogueAsync(cancellationToken).ConfigureAwait(false);
        var byModelName = catalogue.ToDictionary(t => ToModelName(t.Name), t => t.Name, StringComparer.Ordinal);
        var system = SystemPrompt.For(institution, locale, [.. catalogue.Select(t => t.Name)]);

        var messages = new List<Message>();
        foreach (var turn in history ?? [])
        {
            messages.Add(new Message
            {
                Role = turn.Role == "user" ? ConversationRole.User : ConversationRole.Assistant,
                Content = [new ContentBlock { Text = turn.Text }],
            });
        }

        messages.Add(new Message
        {
            Role = ConversationRole.User,
            Content = [new ContentBlock { Text = utterance }],
        });

        var trace = new List<TraceStep>();
        var said = string.Empty;
        var inputTokens = 0;
        var outputTokens = 0;

        for (var round = 0; round < _maxRounds; round++)
        {
            var response = await _bedrock.ConverseAsync(
                new ConverseRequest
                {
                    ModelId = _modelId,
                    System = [new SystemContentBlock { Text = system }],
                    Messages = messages,
                    InferenceConfig = new InferenceConfiguration { MaxTokens = 512, Temperature = 0.2F },
                    ToolConfig = ToolConfigFor(catalogue),
                },
                cancellationToken).ConfigureAwait(false);

            inputTokens += response.Usage?.InputTokens ?? 0;
            outputTokens += response.Usage?.OutputTokens ?? 0;

            var content = response.Output?.Message?.Content ?? [];
            var spoken = string.Join(" ", content.Where(b => b.Text is not null).Select(b => b.Text));
            if (!string.IsNullOrWhiteSpace(spoken))
            {
                said = spoken;
            }

            var calls = content.Where(b => b.ToolUse is not null).Select(b => b.ToolUse).ToList();
            if (calls.Count == 0)
            {
                break;
            }

            messages.Add(response.Output!.Message);

            var results = new List<ContentBlock>();
            foreach (var call in calls)
            {
                var outcome = await RunAsync(call, byModelName, trace.Count + 1, cancellationToken)
                    .ConfigureAwait(false);

                trace.Add(outcome.Step);
                results.Add(outcome.Block);
            }

            messages.Add(new Message { Role = ConversationRole.User, Content = results });
        }

        return new Exchange(said.Trim(), trace, clock.Elapsed, new Usage(inputTokens, outputTokens));
    }

    private async Task<(TraceStep Step, ContentBlock Block)> RunAsync(
        ToolUseBlock call,
        Dictionary<string, string> byModelName,
        int step,
        CancellationToken cancellationToken)
    {
        var clock = Stopwatch.StartNew();

        // Un nombre que el catálogo no contiene es el modelo inventándoselo. Decirlo es mejor que
        // llamar a algo arbitrario, y en la traza se ve como lo que fue.
        if (!byModelName.TryGetValue(call.Name, out var mcpName))
        {
            var missing = $"There is no tool called {call.Name} at this institution.";
            return (
                new TraceStep(step, call.Name, missing, 0, Failed: true),
                ResultBlock(call.ToolUseId, missing, failed: true));
        }

        try
        {
            var text = await _lodge.CallAsync(
                mcpName,
                Documents.ArgumentsOf(call.Input),
                cancellationToken).ConfigureAwait(false);

            return (
                new TraceStep(step, mcpName, text, clock.Elapsed.TotalMilliseconds, Failed: false),
                ResultBlock(call.ToolUseId, text, failed: false));
        }
#pragma warning disable CA1031 // Una herramienta que falla es un turno que sigue, no un proceso que cae:
        catch (Exception error)
#pragma warning restore CA1031
        {
            // el modelo recibe el fallo como resultado y lo cuenta, que es lo que haría un conserje.
            var message = $"That did not work: {error.Message}";
            return (
                new TraceStep(step, mcpName, message, clock.Elapsed.TotalMilliseconds, Failed: true),
                ResultBlock(call.ToolUseId, message, failed: true));
        }
    }

    private static ContentBlock ResultBlock(string id, string text, bool failed) => new()
    {
        ToolResult = new ToolResultBlock
        {
            ToolUseId = id,
            Content = [new ToolResultContentBlock { Text = text }],
            Status = failed ? ToolResultStatus.Error : ToolResultStatus.Success,
        },
    };

    /// <summary>
    /// El catálogo vivo, traducido a lo que el modelo necesita para elegir entre las herramientas.
    /// </summary>
    /// <remarks>
    /// Sin <c>cachePoint</c> dentro de <c>tools</c>: Nova 2 Lite lo rechaza de plano con
    /// <c>extraneous key [cachePoint] is not permitted</c>.
    /// </remarks>
    private static ToolConfiguration ToolConfigFor(IEnumerable<McpClientTool> catalogue) => new()
    {
        Tools = [.. catalogue.Select(tool => new Tool
        {
            ToolSpec = new ToolSpecification
            {
                Name = ToModelName(tool.Name),
                Description = string.IsNullOrWhiteSpace(tool.Description) ? tool.Name : tool.Description,
                InputSchema = new ToolInputSchema { Json = Documents.From(tool.JsonSchema) },
            },
        })],
    };
}
