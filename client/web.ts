import { Platform } from "react-native";

/**
 * Web-only DOM bindings, declared structurally: the plugin tsconfig has no DOM lib (the surfaces
 * must stay RN-portable), and react-native-web hands host-component refs the underlying element.
 * Every export no-ops off the web.
 */

/** The slice of `HTMLElement` this module touches, so `dom` stays free of the DOM lib. */
type DomNode = {
  addEventListener(type: "contextmenu", listener: (event: { preventDefault(): void }) => void): void;
  removeEventListener(type: "contextmenu", listener: (event: { preventDefault(): void }) => void): void;
};

/** A right click on the element opens the in-app menu; the browser's own menu stays shut. */
export function bindContextMenu(node: unknown, open: () => void): () => void {
  if (Platform.OS !== "web") return () => {};
  const element = node as DomNode | null;
  if (typeof element?.addEventListener !== "function") return () => {};
  const handle = (event: { preventDefault(): void }) => {
    event.preventDefault();
    open();
  };
  element.addEventListener("contextmenu", handle);
  return () => element.removeEventListener("contextmenu", handle);
}
