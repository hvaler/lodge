using Amazon;
using Amazon.BedrockRuntime;

using Xunit;

namespace Lodge.Campus.Tests;

/// <summary>
/// El bucle entero: descubrir el catálogo, decidir, llamar, y hablar.
/// </summary>
/// <remarks>
/// <para>
/// Estos tests <b>gastan dinero</b> — cada uno es una invocación de Nova 2 Lite — y necesitan
/// credenciales de AWS. Son pocos y deliberados por eso. Lo que compran es la única prueba que vale
/// de que el camino existe: un modelo eligiendo entre herramientas que no están escritas en ningún
/// sitio de este proyecto, sino descubiertas por MCP contra un servidor real.
/// </para>
/// <para>
/// Se ejecutan con <c>AWS_PROFILE=&lt;el vuestro&gt; dotnet test</c>.
/// </para>
/// </remarks>
[Trait("Category", "Bedrock")]
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
    public async Task Una_pregunta_de_aula_llama_a_la_herramienta_y_devuelve_algo_que_se_puede_decir()
    {
        var token = TestContext.Current.CancellationToken;
        var (lodge, orchestrator) = await AtCarrigmoreAsync(token);
        await using var _ = lodge;

        var exchange = await orchestrator.AskAsync(
            "what room is free right now?",
            "Carrigmore College",
            "en-IE",
            cancellationToken: token);

        Report(exchange);
        Assert.NotEmpty(exchange.Said);
        Assert.Contains(exchange.Trace, step => step.Tool == "campus.find_room");
        Assert.DoesNotContain(exchange.Trace, step => step.Failed);

        // Regla 3 del prompt: lo que sale de aquí lo lee un sintetizador de voz, y los asteriscos
        // los pronuncia.
        Assert.DoesNotContain('*', exchange.Said);
    }

    [Fact]
    public async Task Lo_que_la_institucion_no_publica_se_declina_SIN_llamar_a_nada()
    {
        // UC-03, que es el argumento entero del proyecto. Carrigmore no declara la capacidad de
        // horario, así que su catálogo no trae la herramienta, así que el modelo no tiene nada que
        // llamar. No es que se porte bien: es que no puede portarse mal.
        var token = TestContext.Current.CancellationToken;
        var (lodge, orchestrator) = await AtCarrigmoreAsync(token);
        await using var _ = lodge;

        var exchange = await orchestrator.AskAsync(
            "what is on my timetable tomorrow?",
            "Carrigmore College",
            "en-IE",
            cancellationToken: token);

        Report(exchange);
        Assert.NotEmpty(exchange.Said);
        Assert.Empty(exchange.Trace);
    }

    [Fact]
    public async Task El_historial_viaja_para_que_una_segunda_vuelta_sepa_de_la_primera()
    {
        var token = TestContext.Current.CancellationToken;
        var (lodge, orchestrator) = await AtCarrigmoreAsync(token);
        await using var _ = lodge;

        var exchange = await orchestrator.AskAsync(
            "and the one after that?",
            "Carrigmore College",
            "en-IE",
            [
                new Turn("user", "when does registration close?"),
                new Turn("assistant", "Registration closes on the fourteenth of October."),
            ],
            token);

        Assert.NotEmpty(exchange.Said);
    }

    /// <summary>
    /// Lo que dijo y a que llamo. Cuando uno de estos falla, es lo primero que se quiere leer, y
    /// sin esto el informe solo dice que una cadena estaba vacia.
    /// </summary>
    private static void Report(Exchange exchange)
    {
        var output = TestContext.Current.TestOutputHelper;
        if (output is null)
        {
            return;
        }

        output.WriteLine($"dijo: {exchange.Said}");
        output.WriteLine($"llamo a: {(exchange.Trace.Count == 0 ? "nada" : string.Join(", ", exchange.Trace.Select(s => s.Tool)))}");
        output.WriteLine($"tardo: {exchange.Elapsed.TotalMilliseconds:F0} ms | fichas: {exchange.Usage.InputTokens} entrada, {exchange.Usage.OutputTokens} salida");
    }

    [Fact]
    public void Los_nombres_con_punto_viajan_al_modelo_con_guion_bajo() =>
        // Bedrock rechaza cualquier cosa que no sea [a-zA-Z0-9_-], y el punto es contrato MCP.
        Assert.Equal("campus_find_room", Orchestrator.ToModelName("campus.find_room"));
}
