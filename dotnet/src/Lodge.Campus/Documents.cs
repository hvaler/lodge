using System.Text.Json;

using Amazon.Runtime.Documents;

namespace Lodge.Campus;

/// <summary>
/// Traducción entre el <see cref="Document"/> de Bedrock y el JSON de MCP.
/// </summary>
/// <remarks>
/// Las dos mitades de este proceso hablan JSON y ninguna habla el JSON de la otra: MCP entrega
/// esquemas y argumentos como <see cref="JsonElement"/>, y Converse los quiere como
/// <see cref="Document"/>. Es todo el trabajo que hay aquí, y se hace con los constructores
/// públicos de <see cref="Document"/> en vez de con los serializadores internos del SDK, que no
/// forman parte de su contrato.
/// </remarks>
internal static class Documents
{
    /// <summary>De JSON a lo que Converse entiende.</summary>
    public static Document From(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Object => new Document(
            element.EnumerateObject().ToDictionary(p => p.Name, p => From(p.Value), StringComparer.Ordinal)),
        JsonValueKind.Array => new Document(element.EnumerateArray().Select(From).ToList()),
        JsonValueKind.String => new Document(element.GetString()),
        JsonValueKind.Number => new Document(element.GetDouble()),
        JsonValueKind.True => new Document(true),
        JsonValueKind.False => new Document(false),
        // Null, Undefined: un documento sin valor. Bedrock lo acepta y MCP lo emite.
        _ => new Document(),
    };

    /// <summary>
    /// De lo que el modelo devolvió a los argumentos de una llamada MCP.
    /// </summary>
    /// <remarks>
    /// Sólo el nivel superior se desenvuelve a diccionario, porque es lo que pide la firma de una
    /// llamada a herramienta; lo de dentro se deja como valor plano y el serializador de MCP lo
    /// vuelve a convertir.
    /// </remarks>
    public static Dictionary<string, object?> ArgumentsOf(Document document)
    {
        if (!document.IsDictionary())
        {
            return [];
        }

        return document.AsDictionary()
            .ToDictionary(pair => pair.Key, pair => ValueOf(pair.Value), StringComparer.Ordinal);
    }

    private static object? ValueOf(Document document)
    {
        if (document.IsDictionary())
        {
            return document.AsDictionary()
                .ToDictionary(pair => pair.Key, pair => ValueOf(pair.Value), StringComparer.Ordinal);
        }

        if (document.IsList())
        {
            return document.AsList().Select(ValueOf).ToList();
        }

        if (document.IsString())
        {
            return document.AsString();
        }

        if (document.IsBool())
        {
            return document.AsBool();
        }

        if (document.IsInt())
        {
            return document.AsInt();
        }

        if (document.IsLong())
        {
            return document.AsLong();
        }

        if (document.IsDouble())
        {
            return document.AsDouble();
        }

        return null;
    }
}
