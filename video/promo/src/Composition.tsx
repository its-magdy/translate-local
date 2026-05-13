import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  useCurrentFrame,
} from "remotion";
import { PALETTE, SCENE_FRAMES, TOTAL_FRAMES } from "./theme";
import { SceneHook } from "./scenes/SceneHook";
import { SceneColdOpen } from "./scenes/SceneColdOpen";
import { SceneGlossary } from "./scenes/SceneGlossary";
import { SceneFileMode } from "./scenes/SceneFileMode";
import { SceneMontage } from "./scenes/SceneMontage";
import { SceneCta } from "./scenes/SceneCta";

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.55, 0, 0.7, 0);

const FadeOverlay: React.FC = () => {
  const frame = useCurrentFrame();
  const intro = interpolate(frame, [0, 10], [1, 0], {
    easing: EASE_OUT,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const outro = interpolate(
    frame,
    [TOTAL_FRAMES - 14, TOTAL_FRAMES - 1],
    [0, 1],
    {
      easing: EASE_IN,
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const opacity = Math.max(intro, outro);
  if (opacity <= 0) return null;
  return (
    <AbsoluteFill
      style={{ backgroundColor: PALETTE.bg, opacity, pointerEvents: "none" }}
    />
  );
};

export const TlPromo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.bg }}>
      <Sequence
        from={SCENE_FRAMES.HOOK.start}
        durationInFrames={SCENE_FRAMES.HOOK.duration}
        layout="none"
      >
        <SceneHook />
      </Sequence>
      <Sequence
        from={SCENE_FRAMES.COLD_OPEN.start}
        durationInFrames={SCENE_FRAMES.COLD_OPEN.duration}
        layout="none"
      >
        <SceneColdOpen />
      </Sequence>
      <Sequence
        from={SCENE_FRAMES.GLOSSARY.start}
        durationInFrames={SCENE_FRAMES.GLOSSARY.duration}
        layout="none"
      >
        <SceneGlossary />
      </Sequence>
      <Sequence
        from={SCENE_FRAMES.FILE_MODE.start}
        durationInFrames={SCENE_FRAMES.FILE_MODE.duration}
        layout="none"
      >
        <SceneFileMode />
      </Sequence>
      <Sequence
        from={SCENE_FRAMES.MONTAGE.start}
        durationInFrames={SCENE_FRAMES.MONTAGE.duration}
        layout="none"
      >
        <SceneMontage />
      </Sequence>
      <Sequence
        from={SCENE_FRAMES.CTA.start}
        durationInFrames={SCENE_FRAMES.CTA.duration}
        layout="none"
      >
        <SceneCta />
      </Sequence>
      <FadeOverlay />
    </AbsoluteFill>
  );
};
