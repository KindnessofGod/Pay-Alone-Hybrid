// "embed=1" mode: the app or the shop page runs inside a device frame on /demo. The page may tell it to mute.
let muted = false;
export const isEmbedMuted = () => muted;
export const setEmbedMuted = (on: boolean) => {
  muted = on;
};
export const isEmbedSearch = (search: string) => new URLSearchParams(search).get("embed") === "1";
