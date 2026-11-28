// Connects a Gemini Live session through Firebase AI Logic (Gemini Developer API backend).
// Prototype only, behind ?live=1. See src/lib/hybrid/live.ts for the rules around it.
"use client";
import { getLiveGenerativeModel, ResponseModality, Schema } from "firebase/ai";
import { firebaseAI } from "./client";
import { LIVE_MODEL, type LiveSessionLike } from "../hybrid/live";
import type { Contact } from "../hybrid/crosscheck";
import { liveInstruction } from "../hybrid/livepay";

export async function connectLive(contacts: Contact[], pronunciation: Record<string, string> = {}): Promise<LiveSessionLike> {
  const model = getLiveGenerativeModel(firebaseAI(), {
    model: LIVE_MODEL,
    generationConfig: {
      responseModalities: [ResponseModality.AUDIO],
      speechConfig: { languageCode: "en-US", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    systemInstruction: liveInstruction(contacts, pronunciation),
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
