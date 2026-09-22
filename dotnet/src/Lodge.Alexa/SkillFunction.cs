using System.Collections.Concurrent;

using Alexa.NET.Request;
using Alexa.NET.Response;

using Amazon;
using Amazon.BedrockRuntime;
using Amazon.Lambda.Core;

using Lodge.Campus;

// Newtonsoft, because Alexa.NET requires it. See the note in the csproj.
[assembly: LambdaSerializer(typeof(Amazon.Lambda.Serialization.Json.JsonSerializer))]

namespace Lodge.Alexa;

/// <summary>
/// The Lambda entry point: a second backend for the same Alexa skill, in .NET.
/// </summary>
/// <remarks>
/// <para>
/// Point it at the same skill by swapping one ARN in the developer console, and the two
/// implementations can be compared by speaking to the same device. That comparison is the reason
/// this exists; it is not a replacement for anything.
/// </para>
/// <para>
/// <b>Identity.</b> This talks to the sandbox deployment, which resolves identity from a header. It
/// demonstrates the voice path, not the identity path — that one is demonstrated in the web app,
/// where the sign-in is a real authorization code flow with PKCE.
/// </para>
/// </remarks>
public sealed class SkillFunction
{
    private static readonly string LodgeUrl = Required("LODGE_MCP_URL");
    private static readonly string? SkillId = Environment.GetEnvironmentVariable("LODGE_SKILL_ID");
    private static readonly string Subject =
        Environment.GetEnvironmentVariable("LODGE_SKILL_SUBJECT") ?? "est-0001";

    // Built once per container; both cost something to construct and nothing to keep.
    private static readonly HttpClient Http = new();
    private static readonly IAmazonBedrockRuntime Bedrock = new AmazonBedrockRuntimeClient(
        RegionEndpoint.GetBySystemName(
            Environment.GetEnvironmentVariable("LODGE_BEDROCK_REGION") ?? Orchestrator.DefaultRegion));

    // One MCP connection per institution, kept across warm invocations. The handshake is the only
    // part of a turn that is pure overhead, and the server is stateless, so nothing is being held
    // that a new container could not rebuild.
    private static readonly ConcurrentDictionary<string, Task<LodgeClient>> Connections = new(StringComparer.Ordinal);

    private readonly Skill _skill;

    /// <summary>Wires the routing to a real campus and a real model.</summary>
    public SkillFunction() => _skill = new Skill(
        AskAsync,
        SkillId,
        (envelope, filler, token) => ProgressiveResponse.SendAsync(envelope, filler, Http, token),
        error => LambdaLogger.Log(error.Message));

    /// <summary>What Lambda invokes. One envelope in, one envelope out.</summary>
    public Task<SkillResponse> HandlerAsync(SkillRequest envelope, ILambdaContext context) =>
        _skill.AnswerAsync(envelope, CancellationToken.None);

    private static async Task<string> AskAsync(
        string institution,
        string utterance,
        IReadOnlyList<Turn> history,
        CancellationToken cancellationToken)
    {
        var lodge = await Connections.GetOrAdd(
            institution,
            slug => LodgeClient.ConnectAsync(
                Institutions.EndpointFor(new Uri(LodgeUrl), slug),
                Subject,
                cancellationToken: CancellationToken.None)).ConfigureAwait(false);

        var orchestrator = new Orchestrator(
            lodge,
            Bedrock,
            Environment.GetEnvironmentVariable("LODGE_BEDROCK_MODEL"));

        var exchange = await orchestrator.AskAsync(
            utterance,
            NameOf(institution),
            LocaleOf(institution),
            history,
            cancellationToken).ConfigureAwait(false);

        // What it called, so a CloudWatch log can tell "read the calendar" from "made it up".
        LambdaLogger.Log(
            $"{institution} | {exchange.Elapsed.TotalMilliseconds:F0} ms | "
            + (exchange.Trace.Count == 0 ? "no tools" : string.Join(", ", exchange.Trace.Select(s => s.Tool))));

        return exchange.Said;
    }

    /// <summary>What the institution calls itself, so the model knows whose desk it is.</summary>
    private static string NameOf(string slug) =>
        slug == Institutions.SanTelmo ? "the University of San Telmo" : "Carrigmore College";

    /// <summary>The institution's own locale, which is the institution's to declare, not Alexa's.</summary>
    private static string LocaleOf(string slug) => slug == Institutions.SanTelmo ? "es-ES" : "en-IE";

    /// <summary>Without this there is nothing to bridge to, so it fails loudly at load.</summary>
    private static string Required(string name) =>
        Environment.GetEnvironmentVariable(name)
        ?? throw new InvalidOperationException(
            $"{name} is not set. The skill is an MCP client and needs a server.");
}
