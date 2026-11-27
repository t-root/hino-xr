const scoreWorldCamera = (label: string): number => {
  const text = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  if (/front|user|selfie|facetime|truedepth/.test(text)) return -200;
  if (
    (/tele|periscope|telephoto/.test(text) || /\b([2-9]|[1-9]\d+)(?:\.\d+)?x\b/.test(text)) &&
    !/ultra/.test(text)
  ) {
    return -80;
  }
  let score = 0;
  if (/back|rear|environment|world|\bsau\b/.test(text)) score += 40;
  if (/ultra|\buw\b|wide|goc rong|sieu rong|0\.5/.test(text)) score += 100;
  return score;
};

export const pickWorldCamera = (devices: readonly MediaDeviceInfo[]): string | undefined => {
  const cameras = devices.filter((device) => device.kind === "videoinput");
  if (cameras.length === 0) return undefined;
  const ranked = [...cameras].sort((left, right) => {
    const delta = scoreWorldCamera(right.label) - scoreWorldCamera(left.label);
    return delta !== 0 ? delta : left.label.localeCompare(right.label);
  });
  return ranked[0]?.deviceId;
};
