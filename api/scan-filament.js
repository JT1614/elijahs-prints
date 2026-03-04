// /api/scan-filament.js — Vercel serverless function
// Proxies Anthropic API calls server-side so the API key stays hidden
// and avoids CORS issues from browser-direct calls

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { base64Data, mediaType, existingColours, modeInstruction } = req.body;

  if (!base64Data || !mediaType || !existingColours || !modeInstruction) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY not set in environment variables");
    return res.status(500).json({ error: "API key not configured" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
            { type: "text", text: `You are a filament colour identification assistant for a 3D printing shop called ET Print World.

EXISTING COLOUR LIBRARY:
${JSON.stringify(existingColours, null, 2)}

${modeInstruction}

Respond with ONLY valid JSON (no markdown, no backticks, no preamble):

For MATCH mode (spool photo):
{
  "mode": "match",
  "matches": [
    { "name": "Existing Colour Name", "confidence": "high|medium|low", "reason": "why this matches" }
  ],
  "visibleInfo": "any text/labels visible on the spool",
  "estimatedColour": "your best guess at the colour name if no match",
  "hexEstimate": "#hexcode best visual estimate of the filament colour",
  "suggestedType": "estimated filament type e.g. PLA Silk+",
  "suggestedPremium": false
}

For SCAN mode (box/packaging):
{
  "mode": "scan",
  "brand": "brand name from packaging",
  "colourName": "colour name from packaging",
  "material": "PLA/PETG/TPU etc",
  "finish": "Basic/Matte/Silk/Gradient etc",
  "hexEstimate": "#hexcode best estimate from the packaging",
  "existingMatch": "name of existing colour if it matches one, or null",
  "suggestedName": "suggested ET Print World colour name",
  "suggestedType": "suggested filament type string e.g. PLA Matte",
  "premium": false,
  "allDetailsRead": "summary of everything readable on the packaging"
}

Important:
- For suggestedType, use one of: PLA Basic, PLA Matte, PLA Silk+, PLA Gradient, ELEGOO Silk, Reprapper PLA, PETG, TPU
- For premium, set true for Silk, Gradient, or special finishes
- Match confidence: "high" = very likely the same, "medium" = close but not certain, "low" = possible but unlikely
- Return up to 3 matches, ordered by confidence` }
          ],
        }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Anthropic API error:", response.status, text);
      return res.status(500).json({ error: "AI analysis failed" });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (e) {
    console.error("Scan filament error:", e);
    return res.status(500).json({ error: "AI analysis failed" });
  }
}
