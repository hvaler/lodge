using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace Lodge.Campus;

/// <summary>
/// An MCP client for a Lodge server.
/// </summary>
/// <remarks>
/// <para>
/// This class answers one question: "can our stack consume this?". It speaks Streamable HTTP to the
/// real server, reads the catalogue the server derives from what the adapter declares, and calls
/// whatever is there. It knows nothing about rooms, timetables or faults — which is the point.
/// <b>The contract is the protocol</b>, not an interface written in one language.
/// </para>
/// <para>
/// <b>Identity.</b> The demonstration deployment resolves identity from a header because it runs in
/// sandbox mode over two invented universities. Against a real institution you do not pass
/// <c>subject</c>: you pass a bearer token in <c>headers</c>, and the server verifies it against the
/// issuer that institution declared.
/// </para>
/// </remarks>
public sealed class LodgeClient : IAsyncDisposable
{
    /// <summary>The sandbox identity header. It does not exist outside sandbox mode.</summary>
    public const string DevSubjectHeader = "x-lodge-dev-subject";

    private readonly McpClient _client;

    private LodgeClient(McpClient client) => _client = client;

    /// <summary>Connects to an MCP endpoint and completes the protocol handshake.</summary>
    /// <param name="endpoint">The endpoint, usually from <see cref="Institutions.EndpointFor"/>.</param>
    /// <param name="subject">Who the caller claims to be, for a sandbox deployment. Omit for any other.</param>
    /// <param name="headers">Extra headers; the real <c>Authorization</c> goes here.</param>
    /// <param name="cancellationToken">To abandon the connection.</param>
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
            // No negotiation: Lodge serves Streamable HTTP and nothing else. Leaving this automatic
            // would invite an SSE attempt that can only fail later and worse.
            TransportMode = HttpTransportMode.StreamableHttp,
            AdditionalHeaders = all,
        });

        var client = await McpClient.CreateAsync(transport, cancellationToken: cancellationToken)
            .ConfigureAwait(false);

        return new LodgeClient(client);
    }

    /// <summary>
    /// What this institution publishes.
    /// </summary>
    /// <remarks>
    /// The list differs between institutions served by the same process, and that is the property
    /// to watch: a place with no service desk does not publish "report a fault", so an agent does
    /// not decline to file one — it <em>cannot</em>, because the tool was never in the list.
    /// </remarks>
    public ValueTask<IList<McpClientTool>> CatalogueAsync(CancellationToken cancellationToken = default) =>
        _client.ListToolsAsync(cancellationToken: cancellationToken);

    /// <summary>Calls a tool by name and returns what it said, as text.</summary>
    /// <exception cref="InvalidOperationException">If the catalogue does not publish that tool.</exception>
    public async Task<string> CallAsync(
        string name,
        IReadOnlyDictionary<string, object?>? arguments = null,
        CancellationToken cancellationToken = default)
    {
        var catalogue = await CatalogueAsync(cancellationToken).ConfigureAwait(false);
        var tool = catalogue.FirstOrDefault(t => t.Name == name)
            ?? throw new InvalidOperationException(
                $"This institution does not publish '{name}'. It publishes: {string.Join(", ", catalogue.Select(t => t.Name))}.");

        var result = await tool.CallAsync(
            arguments is null
                ? new Dictionary<string, object?>()
                : new Dictionary<string, object?>(arguments),
            cancellationToken: cancellationToken).ConfigureAwait(false);

        return TextOf(result);
    }

    /// <summary>
    /// The text of a result. Lodge answers in speakable prose, so the other block kinds — images,
    /// audio, resources — do not appear, and are ignored rather than pretended about.
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
