// Connects a Gemini Live session through Firebase AI Logic (Gemini Developer API backend).
// Prototype only, behind ?live=1. See src/lib/hybrid/live.ts for the rules around it.
"use client";
import { getLiveGenerativeModel, ResponseModality, Schema } from "firebase/ai";
import { firebaseAI } from "./client";
import { LIVE_MODEL, LIVE_SYSTEM_INSTRUCTION, type LiveSessionLike } from "../hybrid/live";

export async function connectLive(): Promise<LiveSessionLike> {
  const model = getLiveGenerativeModel(firebaseAI(), {
    model: LIVE_MODEL,
    generationConfig: {
      responseModalities: [ResponseModality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    systemInstruction: LIVE_SYSTEM_INSTRUCTION,
    tools: [
      {
        functionDeclarations: [
          {
            name: "propose_payment",
            description: "Call when the person wants to pay someone. The app shows them the details; it never sends money by itself.",
            parameters: Schema.object({ properties: { request: Schema.string({ description: "The person's own words about the payment." }) } }),
          },
        ],
      },
    ],
  });
  return (await model.connect()) as unknown as LiveSessionLike;
}
