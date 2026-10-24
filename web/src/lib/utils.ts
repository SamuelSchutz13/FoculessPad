export { cn } from "cn"

/** Lets the browser paint (e.g. a spinner) before blocking work such as Argon2 on the main thread. */
export const nextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve)))
