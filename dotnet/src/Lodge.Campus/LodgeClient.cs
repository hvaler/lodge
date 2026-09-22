using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace Lodge.Campus;

/// <summary>
/// Un cliente MCP de un servidor Lodge.
/// </summary>
/// <remarks>
/// <para>
/// Esta clase es la respuesta a una pregunta concreta: «¿puede nuestro stack consumir esto?».
/// Habla Streamable HTTP contra el servidor real, lee el catálogo que el servidor deriva de las
/// capacidades declaradas por el adaptador, y llama a lo que haya. No sabe nada de aulas, horarios
/// ni averías — y eso es justo lo que se quiere demostrar: <b>el contrato es el protocolo</b>, no
/// una interfaz escrita en un lenguaje concreto.
/// </para>
/// <para>
/// <b>Identidad.</b> El despliegue de demostración resuelve la identidad con una cabecera porque
/// corre en modo <c>sandbox</c> sobre dos universidades inventadas. Contra una institución de
/// verdad no se pasa <c>subject</c>: se pasa un <c>Bearer</c> por <c>headers</c>, y el servidor lo
/// verifica contra el emisor que ella haya declarado.
/// </para>
/// </remarks>
public sealed class LodgeClient : IAsyncDisposable
{
    /// <summary>La cabecera de identidad del modo sandbox. No existe fuera de él.</summary>
    public const string DevSubjectHeader = "x-lodge-dev-subject";

    private readonly McpClient _client;

    private LodgeClient(McpClient client) => _client = client;

    /// <summary>Conecta con un endpoint MCP y completa el saludo del protocolo.</summary>
    /// <param name="endpoint">La URL del endpoint, normalmente de <see cref="Institutions.EndpointFor"/>.</param>
    /// <param name="subject">
    /// Quién dice ser quien llama, para un despliegue en modo sandbox. Omitir contra cualquier otro.
    /// </param>
    /// <param name="headers">Cabeceras adicionales; aquí va el <c>Authorization</c> real.</param>
    /// <param name="cancellationToken">Para abandonar la conexión.</param>
    public static async Task<LodgeClient> ConnectAsync(
        Uri endpoint,
        string? subject = null,
        IReadOnlyDictionary<string, string>? headers = null,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(endpoint);

        var all = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (headers is not null)
        {
            foreach (var (name, value) in headers)
            {
                all[name] = value;
            }
        }

        if (subject is not null)
        {
            all[DevSubjectHeader] = subject;
        }

        var transport = new HttpClientTransport(new HttpClientTransportOptions
        {
            Endpoint = endpoint,
            // Sin negociación: Lodge sirve Streamable HTTP y nada más. Dejarlo automático invitaría
            // a un intento de SSE que sólo puede fallar más tarde y peor.
            TransportMode = HttpTransportMode.StreamableHttp,
            AdditionalHeaders = all,
        });

        var client = await McpClient.CreateAsync(transport, cancellationToken: cancellationToken)
            .ConfigureAwait(false);

        return new LodgeClient(client);
    }

    /// <summary>
    /// El catálogo que publica esta institución.
    /// </summary>
    /// <remarks>
    /// La lista cambia de una institución a otra dentro del mismo servidor, y ésa es la propiedad
    /// que hay que mirar: un centro sin mesa de servicio no publica «avisar de una avería», así que
    /// un agente no declina hacerlo — <em>no puede</em>, porque nunca estuvo en la lista.
    /// </remarks>
    public ValueTask<IList<McpClientTool>> CatalogueAsync(CancellationToken cancellationToken = default) =>
        _client.ListToolsAsync(cancellationToken: cancellationToken);

    /// <summary>Llama a una herramienta por su nombre y devuelve lo que diga, en texto.</summary>
    /// <exception cref="InvalidOperationException">Si el catálogo no publica esa herramienta.</exception>
    public async Task<string> CallAsync(
        string name,
        IReadOnlyDictionary<string, object?>? arguments = null,
        CancellationToken cancellationToken = default)
    {
        var catalogue = await CatalogueAsync(cancellationToken).ConfigureAwait(false);
        var tool = catalogue.FirstOrDefault(t => t.Name == name)
            ?? throw new InvalidOperationException(
                $"Esta institución no publica '{name}'. Publica: {string.Join(", ", catalogue.Select(t => t.Name))}.");

        var result = await tool.CallAsync(
            arguments is null
                ? new Dictionary<string, object?>()
                : new Dictionary<string, object?>(arguments),
            cancellationToken: cancellationToken).ConfigureAwait(false);

        return TextOf(result);
    }

    /// <summary>
    /// El texto de un resultado. Lodge responde en prosa hablable, de modo que los demás tipos de
    /// bloque — imágenes, audio, recursos — no aparecen, y se ignoran en vez de fingir que sí.
    /// </summary>
    public static string TextOf(CallToolResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return string.Join(
            "\n",
            result.Content.OfType<TextContentBlock>().Select(block => block.Text));
    }

    /// <inheritdoc />
    public ValueTask DisposeAsync() => _client.DisposeAsync();
}
