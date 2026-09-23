namespace Lodge.Alexa;

/// <summary>
/// Everything the device says that does not come from the model.
/// </summary>
/// <remarks>
/// A mirror of <c>SPEECH</c> in <c>src/lambda/skill.ts</c>, word for word. The greeting is the
/// first thing anybody hears and the error is the last: both are worth having written down rather
/// than assembled, and both have to exist in every language the skill offers, or a Spanish speaker
/// gets an English apology.
/// </remarks>
public sealed record Speech(
    string Welcome,
    string Help,
    string Filler,
    string Bye,
    string More,
    string Broken,
    string NotOurs,
    string Yes,
    string No)
{
    /// <summary>Spanish, which reaches the University of San Telmo.</summary>
    public static Speech Spanish { get; } = new(
        Welcome: "Soy la conserjería. Puedes preguntarme por un aula libre, reservar una sala, tu "
            + "horario, un plazo o avisar de una avería. ¿Qué necesitas?",
        Help: "Pregúntame por ejemplo qué aula está libre ahora en Mendizábal, o qué tienes mañana.",
        Filler: "Un momento, lo miro.",
        Bye: "Hasta luego.",
        More: "¿Algo más?",
        Broken: "No he podido consultarlo ahora mismo. Inténtalo otra vez en un momento.",
        NotOurs: "Esta conserjería no responde a esa aplicación.",
        Yes: "sí",
        No: "no");

    /// <summary>English, which reaches Carrigmore College.</summary>
    public static Speech English { get; } = new(
        Welcome: "This is the campus lodge. Ask me which room is free, when a deadline closes, or "
            + "how to find a room. What do you need?",
        Help: "Try asking which room is free right now, or when registration closes.",
        Filler: "One moment, let me check.",
        Bye: "Goodbye.",
        More: "Anything else?",
        Broken: "I could not look that up just now. Try again in a moment.",
        NotOurs: "This lodge does not answer that application.",
        Yes: "yes",
        No: "no");

    /// <summary>The one to use for a language, as <see cref="Campus.Institutions.LanguageOf"/> reports it.</summary>
    public static Speech For(string language) => language == "es" ? Spanish : English;
}
