namespace Lodge.Campus;

/// <summary>
/// Qué institución alcanza quien habla, y en qué URL vive.
/// </summary>
/// <remarks>
/// <para>
/// Espejo de <c>BY_LANGUAGE</c> y <c>languageOf()</c> en <c>src/lambda/skill.ts</c>. Se escribe dos
/// veces a propósito: el objetivo de esta implementación es demostrar que un cliente .NET consume
/// Lodge <em>sin</em> pasar por el lado TypeScript, así que compartir código lo invalidaría. Lo que
/// no se duplica es el contrato — ése vive en el servidor y se descubre por MCP.
/// </para>
/// <para>
/// El idioma decide, no el país: Alexa manda <c>en-GB</c>, <c>en-US</c>, <c>en-IN</c>… y Carrigmore
/// es irlandés, que ni siquiera es un locale que Alexa tenga.
/// </para>
/// </remarks>
public static class Institutions
{
    /// <summary>Donde vive el endpoint MCP. Una institución responde aquí; varias, debajo.</summary>
    public const string McpPath = "/mcp";

    /// <summary>La institución por defecto del despliegue: responde en <c>/mcp</c> pelado.</summary>
    public const string SanTelmo = "san-telmo";

    /// <summary>La segunda institución, en <c>/mcp/carrigmore</c>.</summary>
    public const string Carrigmore = "carrigmore";

    /// <summary>
    /// El idioma de un locale de Alexa, reducido a lo que decide: <c>es</c> o <c>en</c>.
    /// Cualquier cosa desconocida, y la ausencia de locale, cuentan como inglés.
    /// </summary>
    public static string LanguageOf(string? locale) =>
        locale?.StartsWith("es", StringComparison.OrdinalIgnoreCase) == true ? "es" : "en";

    /// <summary>La institución que alcanza un idioma.</summary>
    public static string SlugFor(string? locale) =>
        LanguageOf(locale) == "es" ? SanTelmo : Carrigmore;

    /// <summary>
    /// La URL del endpoint MCP de una institución dentro de un despliegue.
    /// </summary>
    /// <param name="deployment">La raíz del despliegue; se ignora todo lo que haya tras el host.</param>
    /// <param name="slug">
    /// La institución. <see langword="null"/> pide <c>/mcp</c> pelado, que es la que el despliegue
    /// haya declarado por defecto.
    /// </param>
    public static Uri EndpointFor(Uri deployment, string? slug)
    {
        ArgumentNullException.ThrowIfNull(deployment);

        var root = deployment.GetLeftPart(UriPartial.Authority);
        return new Uri(slug is null ? $"{root}{McpPath}" : $"{root}{McpPath}/{slug}");
    }
}
