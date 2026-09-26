import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";

/** `ready`: when the first run may start. */
export function mount(root: HTMLElement, ready?: Promise<unknown>) {
  // Drawn at once, so a view transition from the landing finds the hero in place.
  const app = createRoot(root);
  flushSync(() =>
    app.render(
      <StrictMode>
        <App ready={ready} />
      </StrictMode>,
    ),
  );
  return () => app.unmount();
}
