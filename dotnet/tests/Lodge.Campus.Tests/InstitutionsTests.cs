using Xunit;

namespace Lodge.Campus.Tests;

/// <summary>
/// The language routing, which is the only logic in this library that does not come from the server.
/// </summary>
public sealed class InstitutionsTests
{
    [Theory]
    [InlineData("es-ES", Institutions.SanTelmo)]
    [InlineData("es-MX", Institutions.SanTelmo)]
    [InlineData("en-GB", Institutions.Carrigmore)]
    [InlineData("en-US", Institutions.Carrigmore)]
    [InlineData("en-IN", Institutions.Carrigmore)]
    // Carrigmore is Irish, and en-IE is not even a locale Alexa has: the language decides.
    [InlineData("de-DE", Institutions.Carrigmore)]
    [InlineData(null, Institutions.Carrigmore)]
    public void the_language_picks_the_institution_and_the_country_does_not(string? locale, string expected) =>
        Assert.Equal(expected, Institutions.SlugFor(locale));

    [Fact]
    public void the_default_institution_answers_at_a_bare_mcp() =>
        Assert.Equal(
            "https://example.test/mcp",
            Institutions.EndpointFor(new Uri("https://example.test/"), null).ToString());

    [Fact]
    public void the_others_answer_beneath_it() =>
        Assert.Equal(
            "https://example.test/mcp/carrigmore",
            Institutions.EndpointFor(new Uri("https://example.test/"), Institutions.Carrigmore).ToString());

    [Fact]
    public void anything_after_the_host_is_discarded() =>
        // Lambda function URLs arrive with a trailing slash, and whoever copies one by hand brings
        // along whatever was next to it.
        Assert.Equal(
            "https://example.test/mcp",
            Institutions.EndpointFor(new Uri("https://example.test/health?x=1"), null).ToString());
}
