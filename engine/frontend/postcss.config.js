import { contsPalettePostcss } from "./conts/palette.mjs";

export default {
  plugins: [
    (await import("tailwindcss")).default(),
    (await import("autoprefixer")).default(),
    contsPalettePostcss(),
  ],
};
