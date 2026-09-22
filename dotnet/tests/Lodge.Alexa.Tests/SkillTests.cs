using System.Text.Json;

using Alexa.NET.Request;
using Alexa.NET.Request.Type;
using Alexa.NET.Response;

using Lodge.Campus;

using Xunit;

namespace Lodge.Alexa.Tests;

/// <summary>
/// The Alexa bridge, driven by the envelopes Alexa actually sends.
/// </summary>
/// <remarks>
/// The device is the one surface nobody can attach a debugger to, and the one most likely to be
/// discovered broken with a camera running. So the translation is exercised here with hand-built
/// envelopes: the launch, the built-ins every skill must answer, the question slot, the session
/// that carries a conversation between turns, and the two ways this can be handed an envelope that
/// is not ours.
///
/// What answers is stubbed on purpose. The campus side is covered in Lodge.Campus.Tests against
/// real services; what is untested until here is whether Alexa's JSON survives the trip.
/// </remarks>
public sealed class SkillTests
{
    private static string Said(SkillResponse response) =>
        ((PlainTextOutputSpeech)response.Response.OutputSpeech).Text;

    private static string? Reprompted(SkillResponse response) =>
        response.Response.Reprompt is null
            ? null
            : ((PlainTextOutputSpeech)response.Response.Reprompt.OutputSpeech).Text;

    private static SkillRequest Envelope(Request request, Session? session = null, string? applicationId = null) => new()
    {
        Version = "1.0",
        Request = request,
        Session = session,
        Context = applicationId is null
            ? null
            : new Context { System = new AlexaSystem { Application = new Application { ApplicationId = applicationId } } },
    };

    private static SkillRequest Asking(string question, Session? session = null, string locale = "es-ES") =>
        Envelope(
            new IntentRequest
            {
                RequestId = "r-1",
                Locale = locale,
                Intent = new Intent
                {
                    Name = Skill.AskIntent,
                    Slots = new Dictionary<string, Slot>(StringComparer.Ordinal)
                    {
                        [Skill.QuestionSlot] = new Slot { Name = Skill.QuestionSlot, Value = question },
                    },
                },
            },
            session);

    private static SkillRequest BuiltIn(string name) =>
        Envelope(new IntentRequest { RequestId = "r-2", Locale = "es-ES", Intent = new Intent { Name = name } });

    /// <summary>Echoes the question back, so a test can see what reached the campus.</summary>
    private static Task<string> Echo(string institution, string utterance, IReadOnlyList<Turn> history, CancellationToken token) =>
        Task.FromResult($"respondo a {utterance}");

    // ── opening and closing ──────────────────────────────────────────────────

    [Fact]
    public async Task it_says_what_it_can_do_when_somebody_just_opens_it()
    {
        var answered = await new Skill(Echo).AnswerAsync(
            Envelope(new LaunchRequest { RequestId = "r-0", Locale = "es-ES" }),
            TestContext.Current.CancellationToken);

        Assert.Contains("aula libre", Said(answered), StringComparison.Ordinal);
        // Left open: a skill that hangs up after hello is a skill nobody uses twice.
        Assert.False(answered.Response.ShouldEndSession);
        Assert.NotNull(Reprompted(answered));
    }

    [Fact]
    public async Task it_answers_the_built_ins_every_skill_has_to_answer()
    {
        var skill = new Skill(Echo);
        var token = TestContext.Current.CancellationToken;

        Assert.True((await skill.AnswerAsync(BuiltIn("AMAZON.StopIntent"), token)).Response.ShouldEndSession);
        Assert.True((await skill.AnswerAsync(BuiltIn("AMAZON.CancelIntent"), token)).Response.ShouldEndSession);

        var help = await skill.AnswerAsync(BuiltIn("AMAZON.HelpIntent"), token);
        Assert.False(help.Response.ShouldEndSession);
        Assert.Contains("Mendizábal", Said(help), StringComparison.Ordinal);
    }

    [Fact]
    public async Task it_ends_without_saying_anything_when_the_session_ends_on_its_own()
    {
        var ended = await new Skill(Echo).AnswerAsync(
            Envelope(new SessionEndedRequest { RequestId = "r-3", Locale = "es-ES" }),
            TestContext.Current.CancellationToken);

        Assert.True(ended.Response.ShouldEndSession);
        Assert.Empty(Said(ended));
    }

    // ── a question ───────────────────────────────────────────────────────────

    [Fact]
    public async Task it_passes_what_was_said_through_and_speaks_what_came_back()
    {
        var answered = await new Skill(Echo).AnswerAsync(
            Asking("¿qué aula está libre?"),
            TestContext.Current.CancellationToken);

        Assert.Equal("respondo a ¿qué aula está libre?", Said(answered));
        Assert.False(answered.Response.ShouldEndSession);
    }

    [Fact]
    public async Task it_falls_back_to_help_rather_than_asking_with_an_empty_slot()
    {
        var asked = false;
        var skill = new Skill((_, _, _, _) => { asked = true; return Task.FromResult("nope"); });

        var answered = await skill.AnswerAsync(Asking("   "), TestContext.Current.CancellationToken);

        Assert.Contains("Pregúntame", Said(answered), StringComparison.Ordinal);
        Assert.False(asked);
    }

    [Fact]
    public async Task it_speaks_before_it_works_so_a_cold_start_is_not_silence()
    {
        var order = new List<string>();
        var skill = new Skill(
            (_, _, _, _) => { order.Add("ask"); return Task.FromResult("ya está"); },
            progressive: (_, _, _) => { order.Add("filler"); return Task.CompletedTask; });

        await skill.AnswerAsync(Asking("¿y mañana?"), TestContext.Current.CancellationToken);

        Assert.Equal(["filler", "ask"], order);
    }

    // ── one skill, two languages ─────────────────────────────────────────────

    [Fact]
    public async Task it_reaches_a_different_institution_depending_on_the_language()
    {
        // The same thing the page demonstrates with its institution switcher, and the same argument:
        // one server answering for more than one place, with the client saying which. Carrigmore has
        // no directory and no service desk, so it publishes three tools where San Telmo publishes
        // six — the device inherits that difference for free.
        var asked = new List<string>();
        var skill = new Skill((institution, _, _, _) => { asked.Add(institution); return Task.FromResult("ok"); });
        var token = TestContext.Current.CancellationToken;

        await skill.AnswerAsync(Asking("¿qué aula está libre?", locale: "es-ES"), token);
        await skill.AnswerAsync(Asking("what room is free?", locale: "en-GB"), token);

        Assert.Equal([Institutions.SanTelmo, Institutions.Carrigmore], asked);
    }

    [Fact]
    public async Task it_answers_in_the_language_it_was_asked_in_before_the_model_says_a_word()
    {
        var skill = new Skill(Echo);
        var token = TestContext.Current.CancellationToken;

        var spanish = await skill.AnswerAsync(Envelope(new LaunchRequest { RequestId = "r-0", Locale = "es-ES" }), token);
        var english = await skill.AnswerAsync(Envelope(new LaunchRequest { RequestId = "r-0", Locale = "en-GB" }), token);

        Assert.Contains("conserjería", Said(spanish), StringComparison.Ordinal);
        Assert.Contains("campus lodge", Said(english), StringComparison.Ordinal);
    }

    [Fact]
    public async Task any_english_locale_is_english_and_so_is_anything_unknown()
    {
        // Alexa sends en-GB, en-US, en-IN… and Carrigmore is Irish, which is not even a locale Alexa
        // has. The language is the part that decides; the country is not.
        var asked = new List<string>();
        var skill = new Skill((institution, _, _, _) => { asked.Add(institution); return Task.FromResult("ok"); });
        var token = TestContext.Current.CancellationToken;

        foreach (var locale in new[] { "en-US", "en-IN", "de-DE" })
        {
            await skill.AnswerAsync(Asking("anything", locale: locale), token);
        }

        // And with no locale at all.
        await skill.AnswerAsync(
            Envelope(new IntentRequest
            {
                RequestId = "r-9",
                Intent = new Intent
                {
                    Name = Skill.AskIntent,
                    Slots = new Dictionary<string, Slot>(StringComparer.Ordinal)
                    {
                        [Skill.QuestionSlot] = new Slot { Name = Skill.QuestionSlot, Value = "anything" },
                    },
                },
            }),
            token);

        Assert.Equal(
            [Institutions.Carrigmore, Institutions.Carrigmore, Institutions.Carrigmore, Institutions.Carrigmore],
            asked);
    }

    // ── the conversation between turns ───────────────────────────────────────

    [Fact]
    public async Task it_carries_what_was_said_back_in_the_session()
    {
        // UC-05 by voice: the first turn asks whether to file, the second acts on it (ADR-011). With
        // nothing carried the model would never see its own question.
        var token = TestContext.Current.CancellationToken;
        var first = await new Skill((_, _, _, _) => Task.FromResult("¿Lo abro?"))
            .AnswerAsync(Asking("el proyector no va"), token);

        var carried = Assert.IsAssignableFrom<IEnumerable<Dictionary<string, string>>>(
            first.SessionAttributes[Skill.HistoryAttribute]).ToList();

        Assert.Equal(2, carried.Count);
        Assert.Equal("el proyector no va", carried[0]["text"]);
        Assert.Equal("¿Lo abro?", carried[1]["text"]);

        // And it comes back in on the next turn, the way Alexa hands it over.
        var seen = new List<IReadOnlyList<Turn>>();
        await new Skill((_, _, history, _) => { seen.Add(history); return Task.FromResult("Abierto."); })
            .AnswerAsync(
                Asking("sí", new Session { Attributes = first.SessionAttributes }),
                token);

        Assert.Equal(2, seen[0].Count);
        Assert.Equal("¿Lo abro?", seen[0][1].Text);
    }

    [Fact]
    public async Task the_conversation_survives_the_json_Lambda_actually_puts_it_through()
    {
        // The tests above hand the session straight back as .NET objects. Lambda does not: it
        // serialises the response and deserialises the next request, so what comes back is
        // JsonElement, not the dictionary that went out. That is a different branch of the reader,
        // and the first version of it was broken — L-002, in the small: a test that does not travel
        // the real path is not testing the real path.
        var token = TestContext.Current.CancellationToken;
        var first = await new Skill((_, _, _, _) => Task.FromResult("¿Lo abro?"))
            .AnswerAsync(Asking("el proyector no va"), token);

        var wire = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(
            JsonSerializer.Serialize(first.SessionAttributes))!
            .ToDictionary(pair => pair.Key, pair => (object)pair.Value, StringComparer.Ordinal);

        var seen = new List<IReadOnlyList<Turn>>();
        await new Skill((_, _, history, _) => { seen.Add(history); return Task.FromResult("Abierto."); })
            .AnswerAsync(Asking("sí", new Session { Attributes = wire }), token);

        Assert.Equal(2, seen[0].Count);
        Assert.Equal("user", seen[0][0].Role);
        Assert.Equal("el proyector no va", seen[0][0].Text);
        Assert.Equal("¿Lo abro?", seen[0][1].Text);
    }

    [Fact]
    public async Task it_keeps_the_session_small_because_it_is_not_a_database()
    {
        var token = TestContext.Current.CancellationToken;
        Dictionary<string, object>? carried = null;

        for (var turn = 0; turn < 6; turn++)
        {
            var answered = await new Skill(Echo).AnswerAsync(
                Asking($"pregunta {turn}", carried is null ? null : new Session { Attributes = carried }),
                token);
            carried = answered.SessionAttributes;
        }

        var history = Assert.IsAssignableFrom<IEnumerable<Dictionary<string, string>>>(
            carried![Skill.HistoryAttribute]);

        Assert.Equal(6, history.Count());
    }

    [Fact]
    public async Task it_ignores_a_session_carrying_something_that_is_not_a_conversation()
    {
        // Session attributes come back from outside this function, so they are somebody else's data.
        var seen = new List<IReadOnlyList<Turn>>();
        var session = new Session
        {
            Attributes = new Dictionary<string, object>(StringComparer.Ordinal)
            {
                [Skill.HistoryAttribute] = "no soy una lista",
            },
        };

        await new Skill((_, _, history, _) => { seen.Add(history); return Task.FromResult("vale"); })
            .AnswerAsync(Asking("hola", session), TestContext.Current.CancellationToken);

        Assert.Empty(seen[0]);
    }

    // ── envelopes that are not ours ──────────────────────────────────────────

    [Fact]
    public async Task it_refuses_one_addressed_to_another_skill()
    {
        var skill = new Skill(Echo, skillId: "amzn1.ask.skill.ours");
        var other = Envelope(
            new IntentRequest { RequestId = "r-5", Locale = "es-ES", Intent = new Intent { Name = Skill.AskIntent } },
            applicationId: "amzn1.ask.skill.somebody-elses");

        var refused = await skill.AnswerAsync(other, TestContext.Current.CancellationToken);

        Assert.True(refused.Response.ShouldEndSession);
        Assert.Contains("no responde a esa aplicación", Said(refused), StringComparison.Ordinal);
    }

    [Fact]
    public async Task a_failed_turn_says_something_a_person_can_act_on()
    {
        Exception? reported = null;
        var broken = new Skill(
            (_, _, _, _) => throw new InvalidOperationException("bedrock is having a day"),
            onError: error => reported = error);

        var answered = await broken.AnswerAsync(
            Asking("¿qué tengo mañana?"),
            TestContext.Current.CancellationToken);

        // Never a raw throw: Alexa turns that into "there was a problem with the requested skill's
        // response", which tells the person nothing and whoever is debugging it less.
        Assert.Contains("Inténtalo otra vez", Said(answered), StringComparison.Ordinal);
        Assert.True(answered.Response.ShouldEndSession);
        Assert.NotNull(reported);
    }
}
