// The two models behind understand(): Gemini Nano on the device and Gemini in the cloud, both through
// Firebase AI Logic. We create them with ONLY_ON_DEVICE and ONLY_IN_CLOUD on purpose: payment
// intents need a different input per path (full sentence on the device, redacted sentence in the
// cloud), so the fallback is ours (understand.ts), not the SDK's. PREFER_ON_DEVICE is used for help
// questions, which carry no personal data (see helpModel).
"use client";
import { getGenerativeModel, InferenceMode, InferenceSource, Schema, type GenerativeModel } from "firebase/ai";
import { firebaseAI } from "./client";
import type { Engines } from "../hybrid/understand";

export const CLOUD_MODEL = "gemini-3.5-flash-lite";

const ACTIONS = ["send", "balance", "history", "repeat", "cancel", "help", "unclear"];

/** JSON schema for Chrome's Prompt API (on-device structured output). */
export const intentJsonSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ACTIONS },
    amountMinor: { type: ["integer", "null"] },
    payee: { type: ["string", "null"] },
  },
  required: ["action", "amountMinor", "payee"],
  additionalProperties: false,
};

const intentSchema = Schema.object({
  properties: {
    action: Schema.enumString({ enum: ACTIONS }),
    amountMinor: Schema.integer({ nullable: true }),
    payee: Schema.string({ nullable: true }),
  },
});

export const INSTRUCTION =
  "You turn one sentence from a person into JSON for a payment app. " +
  "action is one of: send, balance, history, repeat, cancel, help, unclear. " +
  "amountMinor is the amount in kobo (naira x 100) or null. If the sentence says [AMOUNT], use null. " +
  "payee is the person's name exactly as said, or the placeholder such as [CONTACT_1], or null. " +
  "You never approve, confirm or claim that money moved. If unsure, action is unclear.";

const prompt = (said: string) => `${INSTRUCTION}\nSentence: ${said}\nJSON:`;

let onDeviceModel: GenerativeModel | undefined;
let cloudModel: GenerativeModel | undefined;

function onDevice(): GenerativeModel {
  if (!onDeviceModel)
    onDeviceModel = getGenerativeModel(firebaseAI(), {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: {
        createOptions: { expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] },
        promptOptions: { responseConstraint: intentJsonSchema },
      },
    });
  return onDeviceModel;
}

function cloud(): GenerativeModel {
  if (!cloudModel)
    cloudModel = getGenerativeModel(firebaseAI(), {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: CLOUD_MODEL,
        generationConfig: { responseMimeType: "application/json", responseSchema: intentSchema, temperature: 0 },
      },
    });
  return cloudModel;
}

/** Help questions carry no personal data, so the SDK's own hybrid fallback is safe here. */
export function helpModel(): GenerativeModel {
  return getGenerativeModel(firebaseAI(), { mode: InferenceMode.PREFER_ON_DEVICE, inCloudParams: { model: CLOUD_MODEL } });
}

/** Must run on a user gesture (first tap). Starts or finishes the Gemini Nano download. */
export async function prepareOnDevice(onProgress?: (p: number) => void): Promise<boolean> {
  try {
    await onDevice().initializeDeviceModel(onProgress);
    return true;
  } catch {
    return false;
  }
}

export interface LastCall {
  source?: InferenceSource;
  ms: number;
}
export const lastCall: LastCall = { ms: 0 };

async function run(model: GenerativeModel, said: string): Promise<unknown> {
  const t0 = performance.now();
  const result = await model.generateContent(prompt(said));
  lastCall.ms = Math.round(performance.now() - t0);
  lastCall.source = result.response.inferenceSource;
  return result.response.text();
}

export const firebaseEngines: Engines = {
  onDevice: (said) => run(onDevice(), said),
  cloud: (said) => run(cloud(), said),
};
