// Connects a Gemini Live session through Firebase AI Logic (Gemini Developer API backend).
// The default conversation engine (?live=0 turns it off). See src/lib/hybrid/live.ts for the rules around it.
"use client";
import { getLiveGenerativeModel, ResponseModality, Schema } from "firebase/ai";
import { firebaseAI } from "./client";
import { LIVE_MODEL, type LiveSessionLike } from "../hybrid/live";
import type { Contact } from "../hybrid/crosscheck";
import { liveInstruction } from "../hybrid/livepay";
import type { LangCode } from "../hybrid/languages";

export async function connectLive(contacts: Contact[], pronunciation: Record<string, string> = {}, lang: LangCode = "en"): Promise<LiveSessionLike> {
  const model = getLiveGenerativeModel(firebaseAI(), {
    model: LIVE_MODEL,
    generationConfig: {
      responseModalities: [ResponseModality.AUDIO],
      // The native-audio Live models choose the spoken language themselves (Google: "do not support explicitly setting the language code"),
      // so only English sets it; every other language is asked for in the system instruction.
      speechConfig: { ...(lang === "en" ? { languageCode: "en-US" } : {}), voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    systemInstruction: liveInstruction(contacts, pronunciation, lang),
    tools: [
      {
        functionDeclarations: [
          {
            name: "propose_payment",
            description: "Call whenever the person wants to pay, send or give money to someone. The app shows them the details; it never sends money by itself.",
            parameters: Schema.object({
              properties: {
                payee: Schema.enumString({ enum: contacts.map((c) => c.name), description: "The saved person to pay, exactly as listed." }),
                amount_naira: Schema.number({ description: "The amount in naira, as the person said it." }),
                request: Schema.string({ description: "The person's own words about the payment." }),
              },
            }),
          },
        ],
      },
    ],
  });
  return (await model.connect()) as unknown as LiveSessionLike;
}
