using System.Text.Json;

using Alexa.NET.Request;
using Alexa.NET.Request.Type;
using Alexa.NET.Response;

using Lodge.Campus;

namespace Lodge.Alexa;

/// <summary>
/// The routing between Alexa's envelope and a campus, kept apart from everything that needs a
/// network.
/// </summary>
/// <remarks>
/// <para>
/// A second implementation of <c>createSkill()</c> in <c>src/lambda/skill.ts</c>. Separated from
/// the entry point for the same reason it is there: the entry point builds a Bedrock client and
/// demands a server URL while the class is loaded, and a test of something that cannot be
/// constructed without both is a test of nothing.
/// </para>
/// <para>
/// <b>This is not Alexa+.</b> The add-on registry is limited to select partners, so this is a
/// classic custom skill talking to the same MCP server everything else talks to. What it buys is
/// the one thing a browser tab cannot do: a speaker on a table answering out loud.
/// </para>
/// </remarks>
public sealed class Skill
{
    /// <summary>The intent that carries a whole question, rather than a tree of them.</summary>
    public const string AskIntent = "PreguntarAlCampusIntent";

    /// <summary>The slot that holds it. <c>AMAZON.SearchQuery</c>, so it takes free text.</summary>
    public const string QuestionSlot = "pregunta";

    /// <summary>The session attribute the conversation travels in between turns.</summary>
    public const string HistoryAttribute = "history";

    /// <summary>How many turns are carried. A session attribute is not a database.</summary>
    private const int Carried = 6;

    /// <summary>Answers one question at one institution.</summary>
    /// <param name="institution">The slug the language chose.</param>
    /// <param name="utterance">What was asked.</param>
    /// <param name="history">The conversation so far.</param>
    /// <param name="cancellationToken">To abandon.</param>
    public delegate Task<string> AnswerQuestion(
        string institution,
        string utterance,
        IReadOnlyList<Turn> history,
        CancellationToken cancellationToken);

    private readonly AnswerQuestion _ask;
    private readonly string? _skillId;
    private readonly Func<SkillRequest, string, CancellationToken, Task>? _progressive;
    private readonly Action<Exception>? _onError;

    /// <summary>Builds the routing over whatever will actually answer.</summary>
    /// <param name="ask">What answers a question. Injected so this can be driven with no model behind it.</param>
    /// <param name="skillId">
    /// Which skill this was deployed for. Absent skips the check, which is the local-testing case.
    /// </param>
    /// <param name="progressive">Says something while the answer is worked out. Injected for the same reason.</param>
    /// <param name="onError">Where a failed turn goes. Without it a failure is silent, which is worse.</param>
    public Skill(
        AnswerQuestion ask,
        string? skillId = null,
        Func<SkillRequest, string, CancellationToken, Task>? progressive = null,
        Action<Exception>? onError = null)
    {
        _ask = ask ?? throw new ArgumentNullException(nameof(ask));
        _skillId = string.IsNullOrWhiteSpace(skillId) ? null : skillId;
        _progressive = progressive;
        _onError = onError;
    }

    /// <summary>Answers one envelope.</summary>
    public async Task<SkillResponse> AnswerAsync(
        SkillRequest envelope,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(envelope);

        // Everything the device says, in the language it is speaking — which is also the language
        // the institution behind it answers in, because that is the institution's to declare.
        var language = Institutions.LanguageOf(envelope.Request?.Locale);
        var says = Speech.For(language);
        var slug = Institutions.SlugFor(envelope.Request?.Locale);

        try
        {
            if (!IsOurs(envelope))
            {
                return Tell(says.NotOurs);
            }

            switch (envelope.Request)
            {
                // Nothing to say: Alexa is telling us the session is over, not asking anything.
                case SessionEndedRequest:
                    return Tell(string.Empty);

                // Left open: a skill that hangs up after hello is a skill nobody uses twice.
                case LaunchRequest:
                    return Ask(says.Welcome, says.Help);

                case IntentRequest intent:
                    return await AnswerIntentAsync(envelope, intent, says, slug, cancellationToken)
                        .ConfigureAwait(false);

                default:
                    return Ask(says.Help, says.Help);
            }
        }
#pragma warning disable CA1031 // Any failure has to become speech:
        catch (Exception error)
#pragma warning restore CA1031
        {
            // a skill that throws makes Alexa say "there was a problem with the requested skill's
            // response", which tells the person nothing and whoever is debugging it less.
            _onError?.Invoke(error);
            return Tell(says.Broken);
        }
    }

    private async Task<SkillResponse> AnswerIntentAsync(
        SkillRequest envelope,
        IntentRequest intent,
        Speech says,
        string slug,
        CancellationToken cancellationToken)
    {
        var name = intent.Intent?.Name ?? string.Empty;

        if (name is "AMAZON.StopIntent" or "AMAZON.CancelIntent")
        {
            return Tell(says.Bye);
        }

        if (name == "AMAZON.HelpIntent")
        {
            return Ask(says.Help, says.Help);
        }

        // A bare "sí" or "no" arrives as Amazon's own intent, with no carrier phrase to match. It
        // only means something as the answer to what Lodge just asked, so with nothing asked yet
        // it gets the help rather than a turn of its own.
        var history = HistoryIn(envelope);
        var answer = name switch
        {
            "AMAZON.YesIntent" => says.Yes,
            "AMAZON.NoIntent" => says.No,
            _ => null,
        };
        var question = answer ?? (name == AskIntent ? QuestionIn(intent) : null);
        if (question is null || (answer is not null && history.Count == 0))
        {
            return Ask(says.Help, says.Help);
        }

        // The filler goes out before the work starts, not after: filling the gap is its whole job.
        if (_progressive is not null)
        {
            await _progressive(envelope, says.Filler, cancellationToken).ConfigureAwait(false);
        }

        var said = await _ask(slug, question, history, cancellationToken).ConfigureAwait(false);

        // Carried in the session so a second turn can act on the first — which is what makes filing
        // a fault work by voice: the agent asks "shall I open it?", somebody says yes, and the model
        // has its own question in front of it (ADR-011).
        var carried = history
            .Append(new Turn("user", question))
            .Append(new Turn("assistant", said))
            .TakeLast(Carried)
            .ToList();

        var response = Ask(said, says.More);
        response.SessionAttributes = new Dictionary<string, object>(StringComparer.Ordinal)
        {
            [HistoryAttribute] = carried.Select(t => new Dictionary<string, string>(StringComparer.Ordinal)
            {
                ["role"] = t.Role,
                ["text"] = t.Text,
            }).ToList(),
        };

        return response;
    }

    /// <summary>What somebody actually asked, whichever way they got here.</summary>
    public static string? QuestionIn(IntentRequest intent)
    {
        ArgumentNullException.ThrowIfNull(intent);

        if (intent.Intent?.Slots is null
            || !intent.Intent.Slots.TryGetValue(QuestionSlot, out var slot)
            || string.IsNullOrWhiteSpace(slot?.Value))
        {
            return null;
        }

        return slot.Value.Trim();
    }

    /// <summary>
    /// The conversation so far, as Alexa hands it back.
    /// </summary>
    /// <remarks>
    /// Session attributes come back from outside this function, so they are somebody else's data:
    /// anything that is not a conversation is discarded rather than trusted.
    /// </remarks>
    public static IReadOnlyList<Turn> HistoryIn(SkillRequest envelope)
    {
        ArgumentNullException.ThrowIfNull(envelope);

        if (envelope.Session?.Attributes is null
            || !envelope.Session.Attributes.TryGetValue(HistoryAttribute, out var raw))
        {
            return [];
        }

        return raw switch
        {
            JsonElement { ValueKind: JsonValueKind.Array } array =>
                [.. array.EnumerateArray().Select(TurnOf).OfType<Turn>()],
            IEnumerable<object> plain => [.. plain.Select(TurnOf).OfType<Turn>()],
            _ => [],
        };
    }

    /// <remarks>
    /// The non-generic <see cref="System.Collections.IDictionary"/> on purpose. A turn arrives as
    /// <c>Dictionary&lt;string, string&gt;</c> when this reads back what it itself wrote, and as
    /// <c>Dictionary&lt;string, object&gt;</c> or <see cref="JsonElement"/> when it comes off the
    /// wire. Matching the generic interface catches only one of those, and the first version of
    /// this did exactly that: the conversation was silently dropped between turns, which would have
    /// broken confirming a fault by voice. Two tests caught it.
    /// </remarks>
    private static Turn? TurnOf(object? item) => item switch
    {
        JsonElement element => TurnOf(element),
        System.Collections.IDictionary map when map["role"] is { } role && map["text"] is { } text =>
            new Turn(role.ToString() ?? "user", text.ToString() ?? string.Empty),
        _ => null,
    };

    private static Turn? TurnOf(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty("role", out var role)
            || !element.TryGetProperty("text", out var text)
            || text.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return new Turn(role.GetString() ?? "user", text.GetString() ?? string.Empty);
    }

    /// <summary>
    /// Whether this request is for the skill we were deployed for.
    /// </summary>
    /// <remarks>
    /// The trigger permission already scopes who may invoke the function, and this is the second
    /// lock: a function that answers any envelope it is handed answers somebody else's skill.
    /// </remarks>
    private bool IsOurs(SkillRequest envelope) =>
        _skillId is null || envelope.Context?.System?.Application?.ApplicationId == _skillId;

    private static SkillResponse Tell(string text) => Respond(text, reprompt: null, end: true);

    private static SkillResponse Ask(string text, string reprompt) =>
        Respond(text, reprompt, end: false);

    private static SkillResponse Respond(string text, string? reprompt, bool end) => new()
    {
        Version = "1.0",
        Response = new ResponseBody
        {
            OutputSpeech = new PlainTextOutputSpeech(text),
            Reprompt = reprompt is null ? null : new Reprompt(reprompt),
            ShouldEndSession = end,
        },
    };
}
