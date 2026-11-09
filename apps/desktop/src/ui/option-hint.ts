import "./option-hint.css";

export type OptionHintHandle = {
  element: HTMLElement;
  setText: (text: string) => void;
  dispose: () => void;
};

export function mountOptionHint(text: string): OptionHintHandle {
  const element = document.createElement("div");
  element.className = "orbita-option-hint";
  element.textContent = text;

  return {
    element,
    setText: (next) => {
      element.textContent = next;
    },
    dispose: () => {
      element.remove();
    },
  };
}
