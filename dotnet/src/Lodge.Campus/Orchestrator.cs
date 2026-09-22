using System.Diagnostics;

using Amazon.BedrockRuntime;
using Amazon.BedrockRuntime.Model;

using ModelContextProtocol.Client;

namespace Lodge.Campus;

/// <summary>Who said what on an earlier turn.</summary>
/// <param name="Role"><c>user</c> or <c>assistant</c>.</param>
/// <param name="Text">What was said.</param>
public sealed record Turn(string Role, string Text);

/// <summary>One tool call, as it happened.</summary>
/// <param name="Step">Its order within the exchange, starting at 1.</param>
/// <param name="Tool">The tool's MCP name.</param>
/// <param name="Output">What it returned, or the error.</param>
/// <param name="Milliseconds">How long it took.</param>
/// <param name="Failed">Whether it failed.</param>
public sealed record TraceStep(int Step, string Tool, string Output, double Milliseconds, bool Failed);

/// <summary>What an exchange cost, in tokens.</summary>
/// <param name="InputTokens">Billed input tokens.</param>
/// <param name="OutputTokens">Output tokens.</param>
public sealed record Usage(int InputTokens, int OutputTokens);

/// <summary>The result of one question.</summary>
/// <param name="Said">What to say out loud.</param>
/// <param name="Trace">The tools that were called, in order.</param>
/// <param name="Elapsed">How long the whole exchange took.</param>
/// <param name="Usage">What it cost.</param>
public sealed record Exchange(
    string Said,
    IReadOnlyList<TraceStep> Trace,
    TimeSpan Elapsed,
    Usage Usage);

/// <summary>
/// The orchestrator: a model, a catalogue discovered over MCP, and a loop between the two.
/// </summary>
/// <remarks>
/// <para>
/// It does what <c>createOrchestrator()</c> does in <c>src/orchestrator/index.ts</c>, written
/// separately on purpose: the point is to show that the whole path — discover, decide, call, speak
/// — fits in .NET with no TypeScript in between.
/// </para>
/// <para>
/// <b>The trace comes back every time.</b> It is not telemetry: it is the only thing that lets
/// somebody watching a demonstration tell "it read the calendar and worked it out" from "it made
/// that up nicely".
/// </para>
/// </remarks>
public sealed class Orchestrator
{
    /// <summary>The default inference profile. Not the bare id: Nova 2 Lite has no in-region availability.</summary>
    public const string DefaultModelId = "eu.amazon.nova-2-lite-v1:0";

    /// <summary>Where that profile lives.</summary>
    public const string DefaultRegion = "eu-west-1";

    private readonly LodgeClient _lodge;
    private readonly IAmazonBedrockRuntime _bedrock;
    private readonly string _modelId;
    private readonly int _maxRounds;

    /// <summary>Builds an orchestrator over a server and a model that are already connected.</summary>
    /// <param name="lodge">The MCP client of the institution that will answer.</param>
    /// <param name="bedrock">The Bedrock client.</param>
    /// <param name="modelId">The inference profile; <see cref="DefaultModelId"/> by default.</param>
    /// <param name="maxRounds">
    /// How many rounds of "think, call, think again" are allowed. Four is enough for campus
    /// questions and bounds what one strange question can cost.
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
    /// Bedrock rejects a tool name that is not <c>[a-zA-Z0-9_-]</c>, and every Lodge tool is
    /// <c>campus.x</c>.
    /// </summary>
    /// <remarks>
    /// The dot is part of the MCP contract and is not up for negotiation on that side, so the
    /// mapping happens here and nowhere else: the model sees <c>campus_find_room</c>, the server
    /// keeps <c>campus.find_room</c>, and neither has to know about the other's constraint.
    /// </remarks>
    public static string ToModelName(string mcpName)
    {
        ArgumentNullException.ThrowIfNull(mcpName);
        return mcpName.Replace('.', '_');
    }

    /// <summary>Answers what somebody said, using whatever the institution publishes.</summary>
    /// <param name="utterance">What was asked.</param>
    /// <param name="institution">The institution's name, so the model knows who it is.</param>
    /// <param name="locale">Which language to answer in.</param>
    /// <param name="timeZone">The institution's own zone, so the date it is told is its date.</param>
    /// <param name="history">Earlier turns, if any. This is what makes a two-turn confirmation work.</param>
    /// <param name="cancellationToken">To abandon.</param>
    public async Task<Exchange> AskAsync(
        string utterance,
        string institution,
        string locale,
        string timeZone,
        IReadOnlyList<Turn>? history = null,
        CancellationToken cancellationToken = default)
    {
        var clock = Stopwatch.StartNew();

        var catalogue = await _lodge.CatalogueAsync(cancellationToken).ConfigureAwait(false);
        var byModelName = catalogue.ToDictionary(t => ToModelName(t.Name), t => t.Name, StringComparer.Ordinal);
        var system = SystemPrompt.For(
            institution,
            locale,
            [.. catalogue.Select(t => t.Name)],
            SystemPrompt.TodayAt(locale, timeZone, DateTimeOffset.UtcNow));

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

        // A name the catalogue does not contain is the model inventing one. Saying so beats calling
        // something arbitrary, and it shows up in the trace as what it was.
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
#pragma warning disable CA1031 // A failing tool is a turn that continues, not a process that falls over:
        catch (Exception error)
#pragma warning restore CA1031
        {
            // the model gets the failure as a result and says so, which is what a porter would do.
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
    /// The live catalogue, turned into what the model needs to choose between the tools.
    /// </summary>
    /// <remarks>
    /// No <c>cachePoint</c> inside <c>tools</c>: Nova 2 Lite rejects it outright with
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
