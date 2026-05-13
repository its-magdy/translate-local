import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { loadFont as loadArabic } from "@remotion/google-fonts/NotoSansArabic";

export const interFamily = loadInter("normal", {
  weights: ["400", "500", "600", "700", "800"],
  subsets: ["latin"],
}).fontFamily;

export const monoFamily = loadMono("normal", {
  weights: ["400", "500", "700"],
  subsets: ["latin"],
}).fontFamily;

export const arabicFamily = loadArabic("normal", {
  weights: ["400", "500", "700"],
  subsets: ["arabic"],
}).fontFamily;
