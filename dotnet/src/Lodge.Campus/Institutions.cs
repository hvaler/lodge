namespace Lodge.Campus;

/// <summary>
/// Which institution the speaker reaches, and where it lives.
/// </summary>
/// <remarks>
/// <para>
/// A mirror of <c>BY_LANGUAGE</c> and <c>languageOf()</c> in <c>src/lambda/skill.ts</c>. Written
/// twice on purpose: the point of this implementation is to show that a .NET client consumes Lodge
/// <em>without</em> going through the TypeScript side, so sharing code would defeat it. What is not
/// duplicated is the contract — that lives on the server and is discovered over MCP.
/// </para>
/// <para>
/// The language decides, not the country: Alexa sends <c>en-GB</c>, <c>en-US</c>, <c>en-IN</c>… and
/// Carrigmore is Irish, which is not even a locale Alexa has.
/// </para>
/// </remarks>
public static class Institutions
{
    /// <summary>Where the MCP endpoint lives. One institution answers here; several answer beneath it.</summary>
    public const string McpPath = "/mcp";

    /// <summary>The deployment's default institution: it answers at a bare <c>/mcp</c>.</summary>
    public const string SanTelmo = "san-telmo";

    /// <summary>The second institution, at <c>/mcp/carrigmore</c>.</summary>
    public const string Carrigmore = "carrigmore";

    /// <summary>
    /// An Alexa locale reduced to the part that decides: <c>es</c> or <c>en</c>. Anything unknown,
    /// and a missing locale, count as English.
    /// </summary>
    public static string LanguageOf(string? locale) =>
        locale?.StartsWith("es", StringComparison.OrdinalIgnoreCase) == true ? "es" : "en";

    /// <summary>The institution a language reaches.</summary>
    public static string SlugFor(string? locale) =>
        LanguageOf(locale) == "es" ? SanTelmo : Carrigmore;

    /// <summary>
    /// The MCP endpoint of one institution within a deployment.
    /// </summary>
    /// <param name="deployment">The deployment root; everything after the host is ignored.</param>
    /// <param name="slug">
    /// The institution. <see langword="null"/> asks for a bare <c>/mcp</c>, whichever one the
    /// deployment declared as its default.
    /// </param>
    public static Uri EndpointFor(Uri deployment, string? slug)
    {
        ArgumentNullException.ThrowIfNull(deployment);

        var root = deployment.GetLeftPart(UriPartial.Authority);
        return new Uri(slug is null ? $"{root}{McpPath}" : $"{root}{McpPath}/{slug}");
    }
}
