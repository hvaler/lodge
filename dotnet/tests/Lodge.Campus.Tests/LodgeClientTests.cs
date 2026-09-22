using Xunit;

namespace Lodge.Campus.Tests;

/// <summary>
/// The MCP client against a real Lodge server.
/// </summary>
/// <remarks>
/// <para>
/// <b>These tests go over the network on purpose, and do not skip when they cannot.</b> It is this
/// project's L-002: a test that does not travel production's transport is not testing production's
/// transport, and it already cost two shipped features. An MCP client with a stubbed transport
/// proves nothing at all — this is the only kind of test worth writing here.
/// </para>
/// <para>
/// They point at the public demonstration deployment by default, which asks for no credentials.
/// <c>LODGE_DEPLOYMENT</c> points them somewhere else, including a local <c>npm run demo</c>.
/// </para>
/// </remarks>
public sealed class LodgeClientTests
{
    private static Uri Deployment =>
        new(Environment.GetEnvironmentVariable("LODGE_DEPLOYMENT")
            ?? "https://4joapeibeg357e7vyw2dj4pnwa0tmpay.lambda-url.eu-west-1.on.aws/");

    /// <summary>An identity from the generated dataset. Only meaningful in sandbox mode.</summary>
    private const string Student = "est-0001";

    [Fact]
    public async Task san_telmo_publishes_all_six_tools()
    {
        await using var lodge = await LodgeClient.ConnectAsync(
            Institutions.EndpointFor(Deployment, null),
            Student,
            cancellationToken: TestContext.Current.CancellationToken);

        var names = (await lodge.CatalogueAsync(TestContext.Current.CancellationToken))
            .Select(t => t.Name)
            .OrderBy(n => n, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(
            [
                "campus.deadlines",
                "campus.find_room",
                "campus.issue_status",
                "campus.report_issue",
                "campus.timetable",
                "campus.wayfind",
            ],
            names);
    }

    [Fact]
    public async Task carrigmore_publishes_fewer_because_it_declares_fewer()
    {
        // This is UC-07 seen from C#, and it is the test that justifies this whole folder: the
        // catalogue is written nowhere in the client. It is discovered. A college with no directory
        // to bind to does not publish "your timetable", so an agent does not decline to read it —
        // it cannot.
        await using var lodge = await LodgeClient.ConnectAsync(
            Institutions.EndpointFor(Deployment, Institutions.Carrigmore),
            Student,
            cancellationToken: TestContext.Current.CancellationToken);

        var names = (await lodge.CatalogueAsync(TestContext.Current.CancellationToken))
            .Select(t => t.Name)
            .ToArray();

        Assert.DoesNotContain("campus.timetable", names);
        Assert.DoesNotContain("campus.report_issue", names);
        Assert.Contains("campus.find_room", names);
        Assert.Equal(3, names.Length);
    }

    [Fact]
    public async Task a_real_call_comes_back_as_something_speakable()
    {
        await using var lodge = await LodgeClient.ConnectAsync(
            Institutions.EndpointFor(Deployment, Institutions.Carrigmore),
            Student,
            cancellationToken: TestContext.Current.CancellationToken);

        var said = await lodge.CallAsync(
            "campus.find_room",
            cancellationToken: TestContext.Current.CancellationToken);

        // Without asserting which room: that depends on the hour, and a test that pins the result of
        // a live calendar is a test that fails on its own at nine o'clock on some Tuesday.
        Assert.NotEmpty(said);
    }

    [Fact]
    public async Task asking_for_what_this_institution_does_not_publish_fails_naming_what_it_does()
    {
        await using var lodge = await LodgeClient.ConnectAsync(
            Institutions.EndpointFor(Deployment, Institutions.Carrigmore),
            Student,
            cancellationToken: TestContext.Current.CancellationToken);

        var refused = await Assert.ThrowsAsync<InvalidOperationException>(
            () => lodge.CallAsync("campus.timetable", cancellationToken: TestContext.Current.CancellationToken));

        Assert.Contains("campus.find_room", refused.Message, StringComparison.Ordinal);
    }
}
