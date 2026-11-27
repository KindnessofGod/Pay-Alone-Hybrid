// The two models behind understand(): Gemini Nano on the device and Gemini in the cloud, both through
// Firebase AI Logic. We create them with ONLY_ON_DEVICE and ONLY_IN_CLOUD on purpose: payment
// intents need a different input per path (full sentence on the device, redacted sentence in the
// cloud), so the fallback is ours (understand.ts), not the SDK's. PREFER_ON_DEVICE is used for help
// questions, which carry no personal data (see helpModel).
"use client";
import { failAfter, orAfter } from "../hybrid/timeout";
import { getGenerativeModel, InferenceMode, InferenceSource, Schema, type GenerativeModel } from "firebase/ai";
import { firebaseAI } from "./client";
import type { Engines } from "../hybrid/understand";
import type { ChatEngines } from "../hybrid/chat";
import { oneAtATime } from "../hybrid/serial";

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
let chatOnDeviceModel: GenerativeModel | undefined;
let chatCloudModel: GenerativeModel | undefined;
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

/** Open conversation, on the device: plain text out (no JSON schema). Nano's own settings are used. */
function chatOnDevice(): GenerativeModel {
  if (!chatOnDeviceModel)
    chatOnDeviceModel = getGenerativeModel(firebaseAI(), {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams: { createOptions: { expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] } },
    });
  return chatOnDeviceModel;
}

/** Open conversation, in the cloud: plain text, a little creative. It only ever receives redacted text (chat.ts). */
function chatCloud(): GenerativeModel {
  if (!chatCloudModel)
    chatCloudModel = getGenerativeModel(firebaseAI(), {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: { model: CLOUD_MODEL, generationConfig: { temperature: 0.6, maxOutputTokens: 160 } },
    });
  return chatCloudModel;
}

/** Help questions carry no personal data, so the SDK's own hybrid fallback is safe here. */
export function helpModel(): GenerativeModel {
  return getGenerativeModel(firebaseAI(), { mode: InferenceMode.PREFER_ON_DEVICE, inCloudParams: { model: CLOUD_MODEL } });
}

/** Must run on a user gesture (first tap). Starts or finishes the Gemini Nano download. */
export async function prepareOnDevice(onProgress?: (p: number) => void): Promise<boolean> {
  try {
    // The model is usually already on the computer; if Chrome stalls, carry on without it.
    return await orAfter(onDevice().initializeDeviceModel(onProgress).then(() => true), 8_000, false);
  } catch {
    return false;
  }
}

export interface LastCall {
  source?: InferenceSource;
  ms: number;
}
export const lastCall: LastCall = { ms: 0 };

async function run(model: GenerativeModel, text: string): Promise<string> {
  const t0 = performance.now();
  const result = await model.generateContent(text);
  lastCall.ms = Math.round(performance.now() - t0);
  lastCall.source = result.response.inferenceSource;
  return result.response.text();
}

// One on-device call at a time, intent and chat alike: the SDK destroys the previous Chrome session when it
// starts a new one.
const onDeviceQueue = oneAtATime(<T>(job: () => Promise<T>) => job());

async function onDeviceCall(model: GenerativeModel, text: string, ms: number): Promise<string> {
  return onDeviceQueue(async () => {
    // On a CPU-only PC the first answer includes loading the model into memory; warmUpOnDevice() does that early.
    const out = await failAfter(run(model, text), ms, "Gemini Nano");
    // Honesty guard: only count an answer as on-device if the SDK says it ran on the device.
    if (lastCall.source !== InferenceSource.ON_DEVICE) throw new Error("not answered on device");
    return out;
  });
}
const onDeviceOnce = (said: string) => onDeviceCall(onDevice(), prompt(said), 30_000);

/** Loads Gemini Nano into memory right after Start, with a made-up sentence, so the person's first request is fast. */
export function warmUpOnDevice(): Promise<boolean> {
  return onDeviceOnce("send 100 naira to Tunde").then(
    () => true,
    () => false,
  );
}

export const firebaseEngines: Engines = {
  onDevice: onDeviceOnce,
  cloud: (said) => failAfter(run(cloud(), prompt(said)), 10_000, "The online model"),
};

/** The open conversation. The prompt already holds the persona and history (chat.ts); the cloud one is redacted there. */
export const chatEngines: ChatEngines = {
  onDevice: (text) => onDeviceCall(chatOnDevice(), text, 15_000),
  cloud: async (text) => {
    const out = await failAfter(run(chatCloud(), text), 10_000, "The online model");
    // Honesty guard: only count it as online if the SDK says so.
    if (lastCall.source !== InferenceSource.IN_CLOUD) throw new Error("not answered online");
    return out;
  },
};
