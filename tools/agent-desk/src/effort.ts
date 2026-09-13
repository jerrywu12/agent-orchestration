export const efforts = ["XS", "S", "M", "L", "XL"] as const;
export type Effort = (typeof efforts)[number];
export const effortHelp =
  "Development effort including tests, verification and review: XS <2h, S 2–4h, M 1–2d, L 3–5d, XL >5d.";
export const effortRanges: Record<Effort, string> = {
  XS: "<2h",
  S: "2–4h",
  M: "1–2d",
  L: "3–5d",
  XL: ">5d",
};
export function compareEffort(
  left: Effort | null | undefined,
  right: Effort | null | undefined,
  descending = false,
) {
  if (left == null) return right == null ? 0 : 1;
  if (right == null) return -1;
  return (
    (efforts.indexOf(left) - efforts.indexOf(right)) * (descending ? -1 : 1)
  );
}
