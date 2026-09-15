import { h264ParseConfiguration } from "@yume-chan/scrcpy";

export interface VideoConfig {
  /** WebCodecs codec string, e.g. `avc1.42c01e`. */
  codec: string;
  codedWidth: number;
  codedHeight: number;
  croppedWidth: number;
  croppedHeight: number;
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, "0");
}

/**
 * Builds the `avc1.PPCCLL` codec string WebCodecs expects: profile_idc,
 * constraint flags byte, and level_idc, each as two hex digits.
 */
export function avcCodecString(
  profileIndex: number,
  constraintSet: number,
  levelIndex: number,
): string {
  return `avc1.${hex2(profileIndex)}${hex2(constraintSet)}${hex2(levelIndex)}`;
}

/**
 * Reads an H.264 configuration packet (the SPS/PPS scrcpy sends before the
 * first frame, and again after a rotation) into a decoder configuration.
 */
export function parseH264Config(data: Uint8Array): VideoConfig {
  const parsed = h264ParseConfiguration(data);
  return {
    codec: avcCodecString(
      parsed.profileIndex,
      parsed.constraintSet,
      parsed.levelIndex,
    ),
    codedWidth: parsed.encodedWidth,
    codedHeight: parsed.encodedHeight,
    croppedWidth: parsed.croppedWidth,
    croppedHeight: parsed.croppedHeight,
  };
}
