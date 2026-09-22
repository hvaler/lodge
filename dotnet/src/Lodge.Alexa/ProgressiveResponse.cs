using System.Net.Http.Json;

using Alexa.NET.Request;

namespace Lodge.Alexa;

/// <summary>
/// Tells the device to say something while the answer is still being worked out.
/// </summary>
/// <remarks>
/// <para>
/// The turn measured at 2 829 ms inside the function against Alexa's 8 s cut-off, so this is not
/// strictly needed — but a cold start on the one take that matters is a bad way to find out, and
/// two seconds of silence from a speaker feels much longer than two seconds of silence on a screen.
/// </para>
/// <para>
/// Hand-written rather than taken from a library, because it is one POST and because the failure
/// policy matters more than the call: <b>it is never allowed to fail the turn.</b> If the directive
/// service is unreachable the answer still goes out, just without the filler.
/// </para>
/// </remarks>
public static class ProgressiveResponse
{
    /// <summary>Sends the filler, and swallows anything that goes wrong doing it.</summary>
    /// <param name="envelope">The request being answered; it carries where to send this and the token.</param>
    /// <param name="text">What to say meanwhile.</param>
    /// <param name="http">The client to send it with.</param>
    /// <param name="cancellationToken">To abandon.</param>
    public static async Task SendAsync(
        SkillRequest envelope,
        string text,
        HttpClient http,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(envelope);
        ArgumentNullException.ThrowIfNull(http);

        var system = envelope.Context?.System;
        var requestId = envelope.Request?.RequestId;

        if (string.IsNullOrEmpty(system?.ApiEndpoint)
            || string.IsNullOrEmpty(system.ApiAccessToken)
            || string.IsNullOrEmpty(requestId))
        {
            return;
        }

        try
        {
            using var request = new HttpRequestMessage(
                HttpMethod.Post,
                $"{system.ApiEndpoint.TrimEnd('/')}/v1/directives")
            {
                Content = JsonContent.Create(new
                {
                    header = new { requestId },
                    directive = new { type = "VoicePlayer.Speak", speech = text },
                }),
            };

            request.Headers.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", system.ApiAccessToken);

            using var response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false);
        }
#pragma warning disable CA1031 // Deliberately swallowed, and the reason is the point: this is filler.
        catch (Exception)
#pragma warning restore CA1031
        {
            // Failing the answer because the filler did not arrive would trade the thing that
            // matters for the thing that does not.
        }
    }
}
