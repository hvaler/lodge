namespace Lodge.Campus;

/// <summary>
/// La instrucción bajo la que trabaja el modelo.
/// </summary>
/// <remarks>
/// <para>
/// Traducción literal de <c>systemPrompt()</c> en <c>src/orchestrator/index.ts</c>, y se mantiene
/// literal a propósito: estas reglas <b>son</b> el comportamiento que exigen los casos de uso, no
/// una guía de estilo. La regla 1 es UC-03 y la 4 es lo que hace que el catálogo derivado se note
/// al hablar. Cambiar una palabra aquí cambia lo que el altavoz contesta.
/// </para>
/// <para>
/// Corta, y casi toda prohibiciones. Lo que importa en un asistente de voz de una institución es lo
/// que <em>no</em> hace: no inventar una fecha, no responder largo, no arrogarse una capacidad que
/// el catálogo no ofrece.
/// </para>
/// </remarks>
public static class SystemPrompt
{
    /// <summary>Construye la instrucción para una institución, un idioma y un catálogo.</summary>
    public static string For(string institution, string locale, IReadOnlyCollection<string> toolNames)
    {
        ArgumentNullException.ThrowIfNull(toolNames);

        var last = toolNames.Count > 0
            ? $"Tools available at this institution: {string.Join(", ", toolNames)}."
            : "You have no tools here, so you can only explain that you cannot help.";

        return string.Join(
            "\n",
            $"You are the porter's desk at {institution}. You answer students and staff out loud.",
            "",
            $"Answer in the language of this locale: {locale}. Match it exactly, including for numbers and dates.",
            "",
            "Rules, in order of importance:",
            "1. Never invent a fact about the campus. Rooms, timetables, deadlines and faults come only from",
            "   the tools. If a tool returns nothing, say plainly that it is not on record and suggest asking",
            "   the registry. A confidently wrong deadline is how somebody misses the real one.",
            "2. Keep it to one or two sentences. This is spoken aloud, not read.",
            "3. Plain sentences only. No markdown, no asterisks, no bullet points, no headings: a speech",
            "   synthesiser reads the symbols out, so \"**INC-2026-0032**\" becomes \"asterisk asterisk\".",
            "4. Use the tools available to you and nothing else. If what is asked needs a tool you do not",
            "   have, say this institution cannot answer that here.",
            "5. Repeat back reference numbers exactly as the tool gave them.",
            "",
            last);
    }
}
