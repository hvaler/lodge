using System.Text.Json;

using Amazon.Runtime.Documents;

namespace Lodge.Campus;

/// <summary>
/// Translation between Bedrock's <see cref="Document"/> and MCP's JSON.
/// </summary>
/// <remarks>
/// Both halves of this process speak JSON and neither speaks the other's: MCP hands over schemas
/// and arguments as <see cref="JsonElement"/>, and Converse wants them as <see cref="Document"/>.
/// That is all the work there is here, and it is done with <see cref="Document"/>'s public
/// constructors rather than the SDK's internal marshallers, which are not part of its contract.
/// </remarks>
internal static class Documents
{
    /// <summary>From JSON to what Converse understands.</summary>
    public static Document From(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Object => new Document(
            element.EnumerateObject().ToDictionary(p => p.Name, p => From(p.Value), StringComparer.Ordinal)),
        JsonValueKind.Array => new Document(element.EnumerateArray().Select(From).ToList()),
        JsonValueKind.String => new Document(element.GetString()),
        JsonValueKind.Number => new Document(element.GetDouble()),
        JsonValueKind.True => new Document(true),
        JsonValueKind.False => new Document(false),
        // Null, Undefined: a document with no value. Bedrock accepts it and MCP emits it.
        _ => new Document(),
    };

    /// <summary>
    /// From what the model returned to the arguments of an MCP call.
    /// </summary>
    /// <remarks>
    /// Only the top level is unwrapped into a dictionary, because that is what a tool call's
    /// signature asks for; what is inside stays a plain value and MCP's serialiser converts it back.
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
