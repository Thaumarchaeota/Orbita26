import "./section-title.css";

export type SectionTitleHandle = {
  element: HTMLElement;
  setText: (text: string) => void;
  dispose: () => void;
};

export function mountSectionTitle(text: string): SectionTitleHandle {
  const element = document.createElement("div");
  element.className = "orbita-section-title";
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
