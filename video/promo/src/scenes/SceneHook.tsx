import { AbsoluteFill } from "remotion";
import { PALETTE } from "../theme";

export const SceneHook: React.FC = () => {
  return (
    <AbsoluteFill
      style={{
        backgroundColor: PALETTE.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    />
  );
};
