using Xunit;

namespace Lodge.Campus.Tests;

/// <summary>
/// El enrutado por idioma, que es la única lógica de esta biblioteca que no viene del servidor.
/// </summary>
public sealed class InstitutionsTests
{
    [Theory]
    [InlineData("es-ES", Institutions.SanTelmo)]
    [InlineData("es-MX", Institutions.SanTelmo)]
    [InlineData("en-GB", Institutions.Carrigmore)]
    [InlineData("en-US", Institutions.Carrigmore)]
    [InlineData("en-IN", Institutions.Carrigmore)]
    // Carrigmore es irlandés, y en-IE ni siquiera es un locale que Alexa tenga: decide el idioma.
    [InlineData("de-DE", Institutions.Carrigmore)]
    [InlineData(null, Institutions.Carrigmore)]
    public void El_idioma_elige_institucion_y_el_pais_no(string? locale, string expected) =>
        Assert.Equal(expected, Institutions.SlugFor(locale));

    [Fact]
    public void La_institucion_por_defecto_responde_en_mcp_pelado() =>
        Assert.Equal(
            "https://ejemplo.test/mcp",
            Institutions.EndpointFor(new Uri("https://ejemplo.test/"), null).ToString());

    [Fact]
    public void Las_demas_responden_debajo() =>
        Assert.Equal(
            "https://ejemplo.test/mcp/carrigmore",
            Institutions.EndpointFor(new Uri("https://ejemplo.test/"), Institutions.Carrigmore).ToString());

    [Fact]
    public void Lo_que_venga_tras_el_host_se_descarta() =>
        // Las URL de función de Lambda llegan con barra final, y quien las copia a mano trae de todo.
        Assert.Equal(
            "https://ejemplo.test/mcp",
            Institutions.EndpointFor(new Uri("https://ejemplo.test/health?x=1"), null).ToString());
}
