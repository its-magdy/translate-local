import { AbsoluteFill, Sequence } from "remotion";
import { PALETTE, SCENE_FRAMES } from "./theme";
import { SceneHook } from "./scenes/SceneHook";
import { SceneColdOpen } from "./scenes/SceneColdOpen";
import { SceneGlossary } from "./scenes/SceneGlossary";
import { SceneFileMode } from "./scenes/SceneFileMode";
import { SceneMontage } from "./scenes/SceneMontage";
import { SceneCta } from "./scenes/SceneCta";

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
    </AbsoluteFill>
  );
};
