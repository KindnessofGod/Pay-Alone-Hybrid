// The person's remembered choice to use Google's online speech. Stored only in this browser; off by default.
export const CLOUD_SPEECH_KEY = "payalone.cloudSpeech";

export function readCloudOptIn(storage: Storage | undefined): boolean {
  try {
    return storage?.getItem(CLOUD_SPEECH_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCloudOptIn(storage: Storage | undefined, on: boolean): void {
  try {
    if (on) storage?.setItem(CLOUD_SPEECH_KEY, "1");
    else storage?.removeItem(CLOUD_SPEECH_KEY);
  } catch {
    /* blocked storage: the choice just lasts for this visit */
  }
}
