using Xunit;

namespace Lodge.Campus.Tests;

/// <summary>
/// El cliente MCP contra un servidor Lodge de verdad.
/// </summary>
/// <remarks>
/// <para>
/// <b>Estos tests salen a la red a propósito, y no se saltan si no pueden.</b> Es la L-002 del
/// proyecto: un test que no recorre el transporte de producción no prueba el transporte de
/// producción, y ya costó dos funcionalidades entregadas rotas. Un cliente MCP con el transporte
/// simulado no prueba absolutamente nada — es la única clase de test que este proyecto necesita
/// aquí.
/// </para>
/// <para>
/// Por defecto apuntan al despliegue público de demostración, que no pide credenciales. Con
/// <c>LODGE_DEPLOYMENT</c> se apunta a otro, incluido un <c>npm run demo</c> local.
/// </para>
/// </remarks>
public sealed class LodgeClientTests
{
    private static Uri Deployment =>
        new(Environment.GetEnvironmentVariable("LODGE_DEPLOYMENT")
            ?? "https://4joapeibeg357e7vyw2dj4pnwa0tmpay.lambda-url.eu-west-1.on.aws/");

    /// <summary>Una identidad del conjunto de datos generado. Sólo vale en modo sandbox.</summary>
    private const string Student = "est-0001";

    [Fact]
    public async Task San_Telmo_publica_las_seis_herramientas()
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
    public async Task Carrigmore_publica_menos_porque_declara_menos()
    {
        // Esto es UC-07 visto desde C#, y es el test que justifica toda esta carpeta: el catálogo no
        // está escrito en ninguna parte del cliente. Se descubre. Un centro sin directorio LDAP al
        // que atarse no publica «tu horario», así que un agente no declina consultarlo: no puede.
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
    public async Task Una_llamada_de_verdad_devuelve_texto_hablable()
    {
        await using var lodge = await LodgeClient.ConnectAsync(
            Institutions.EndpointFor(Deployment, Institutions.Carrigmore),
            Student,
            cancellationToken: TestContext.Current.CancellationToken);

        var said = await lodge.CallAsync(
            "campus.find_room",
            cancellationToken: TestContext.Current.CancellationToken);

        // Sin afirmar qué aula: depende de la hora, y un test que fija el resultado de un calendario
        // vivo es un test que fallará solo a las nueve de la mañana de algún martes.
        Assert.NotEmpty(said);
    }

    [Fact]
    public async Task Pedir_algo_que_la_institucion_no_publica_falla_diciendo_lo_que_si()
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
