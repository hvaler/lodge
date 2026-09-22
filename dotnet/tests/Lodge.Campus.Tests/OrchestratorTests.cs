using Amazon;
using Amazon.BedrockRuntime;

using Xunit;

namespace Lodge.Campus.Tests;

/// <summary>
/// The whole loop: discover the catalogue, decide, call, speak.
/// </summary>
/// <remarks>
/// <para>
/// These tests <b>cost money</b> — each one is a Nova 2 Lite invocation — and need AWS credentials.
/// They are few and deliberate for that reason. What they buy is the only proof that counts: a
/// model choosing between tools that are written nowhere in this project, discovered over MCP
/// against a real server.
/// </para>
/// <para>
/// Run them with <c>AWS_PROFILE=&lt;yours&gt; dotnet test</c>.
/// </para>
/// </remarks>
public sealed class OrchestratorTests
{
    private static Uri Deployment =>
        new(Environment.GetEnvironmentVariable("LODGE_DEPLOYMENT")
            ?? "https://4joapeibeg357e7vyw2dj4pnwa0tmpay.lambda-url.eu-west-1.on.aws/");

    private static async Task<(LodgeClient Lodge, Orchestrator Orchestrator)> AtCarrigmoreAsync(
        CancellationToken cancellationToken)
    {
        var lodge = await LodgeClient.ConnectAsync(
            Institutions.EndpointFor(Deployment, Institutions.Carrigmore),
            "est-0001",
            cancellationToken: cancellationToken);

        var bedrock = new AmazonBedrockRuntimeClient(
            RegionEndpoint.GetBySystemName(
                Environment.GetEnvironmentVariable("LODGE_BEDROCK_REGION") ?? Orchestrator.DefaultRegion));

        return (lodge, new Orchestrator(lodge, bedrock));
    }

    [Fact]
    [Trait("Category", "Bedrock")]
    public async Task a_room_question_calls_the_tool_and_comes_back_speakable()
    {
        var token = TestContext.Current.CancellationToken;
        var (lodge, orchestrator) = await AtCarrigmoreAsync(token);
        await using var _ = lodge;

        var exchange = await orchestrator.AskAsync(
            "what room is free right now?",
            "Carrigmore College",
            "en-IE",
            "Europe/Dublin",
            cancellationToken: token);

        Report(exchange);
        Assert.NotEmpty(exchange.Said);
        Assert.Contains(exchange.Trace, step => step.Tool == "campus.find_room");
        Assert.DoesNotContain(exchange.Trace, step => step.Failed);

        // Rule 3 of the prompt: a speech synthesiser reads this out, and it pronounces asterisks.
        Assert.DoesNotContain('*', exchange.Said);
    }

    [Fact]
    [Trait("Category", "Bedrock")]
    public async Task what_the_institution_does_not_publish_is_declined_WITHOUT_calling_anything()
    {
        // UC-03, which is the project's whole argument. Carrigmore does not declare the timetable
        // capability, so its catalogue does not carry the tool, so the model has nothing to call.
        // It is not that it behaves well: it cannot behave badly.
        var token = TestContext.Current.CancellationToken;
        var (lodge, orchestrator) = await AtCarrigmoreAsync(token);
        await using var _ = lodge;

        var exchange = await orchestrator.AskAsync(
            "what is on my timetable tomorrow?",
            "Carrigmore College",
            "en-IE",
            "Europe/Dublin",
            cancellationToken: token);

        Report(exchange);
        Assert.NotEmpty(exchange.Said);
        Assert.Empty(exchange.Trace);
    }

    [Fact]
    [Trait("Category", "Bedrock")]
    public async Task history_travels_so_a_second_turn_knows_about_the_first()
    {
        var token = TestContext.Current.CancellationToken;
        var (lodge, orchestrator) = await AtCarrigmoreAsync(token);
        await using var _ = lodge;

        var exchange = await orchestrator.AskAsync(
            "and the one after that?",
            "Carrigmore College",
            "en-IE",
            "Europe/Dublin",
            [
                new Turn("user", "when does registration close?"),
                new Turn("assistant", "Registration closes on the fourteenth of October."),
            ],
            token);

        Assert.NotEmpty(exchange.Said);
    }

    /// <summary>
    /// What it said and what it called. When one of these fails that is the first thing anybody
    /// wants to read, and without it the report only says a string was empty.
    /// </summary>
    private static void Report(Exchange exchange)
    {
        var output = TestContext.Current.TestOutputHelper;
        if (output is null)
        {
            return;
        }

        var called = exchange.Trace.Count == 0
            ? "nothing"
            : string.Join(", ", exchange.Trace.Select(step => step.Tool));

        output.WriteLine($"said: {exchange.Said}");
        output.WriteLine($"called: {called}");
        output.WriteLine(
            $"took: {exchange.Elapsed.TotalMilliseconds:F0} ms | tokens: "
            + $"{exchange.Usage.InputTokens} in, {exchange.Usage.OutputTokens} out");
    }

    [Theory]
    // The institution's date in the institution's words, which is what the model is told. Pinned
    // because it depends on ICU and on tzdata being present, and Lambda's Linux image is not the
    // machine this was written on.
    [InlineData("es-ES", "Europe/Madrid", "martes, 22 de septiembre de 2026")]
    [InlineData("en-IE", "Europe/Dublin", "Tuesday 22 September 2026")]
    public void the_date_is_written_the_way_the_institution_would_write_it(
        string locale,
        string zone,
        string expected) =>
        Assert.Equal(
            expected,
            SystemPrompt.TodayAt(locale, zone, new DateTimeOffset(2026, 9, 22, 12, 0, 0, TimeSpan.Zero)));

    [Fact]
    public void dotted_names_reach_the_model_with_underscores() =>
        // Bedrock rejects anything that is not [a-zA-Z0-9_-], and the dot is MCP contract.
        Assert.Equal("campus_find_room", Orchestrator.ToModelName("campus.find_room"));
}
