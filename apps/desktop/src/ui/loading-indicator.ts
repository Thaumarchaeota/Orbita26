import "./loading-indicator.css";

export type LoadingIndicatorSize = "compact" | "inline";

export type LoadingIndicatorOptions = {
  size?: LoadingIndicatorSize;
  label?: string;
};

export type LoadingIndicatorHandle = {
  root: HTMLElement;
  setLoading: (loading: boolean, label?: string) => void;
  dispose: () => void;
};

export function mountLoadingIndicator(
  container: HTMLElement,
  options: LoadingIndicatorOptions = {},
): LoadingIndicatorHandle {
  const size = options.size ?? "inline";
  const root = document.createElement("div");
  root.className = `orbita-loading-indicator is-${size}`;
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.setAttribute("aria-busy", "false");
  root.hidden = true;

  const spinner = document.createElement("span");
  spinner.className = "orbita-loading-indicator-spinner";
  spinner.setAttribute("aria-hidden", "true");

  const labelEl = document.createElement("span");
  labelEl.className = "orbita-loading-indicator-label";

  root.append(spinner, labelEl);
  container.appendChild(root);

  function setLoading(loading: boolean, label?: string): void {
    root.hidden = !loading;
    root.setAttribute("aria-busy", String(loading));
    if (label !== undefined) labelEl.textContent = label;
    else if (!labelEl.textContent && options.label) labelEl.textContent = options.label;
    labelEl.hidden = !labelEl.textContent;
  }

  if (options.label) {
    labelEl.textContent = options.label;
    labelEl.hidden = false;
  }

  return {
    root,
    setLoading,
    dispose: () => root.remove(),
  };
}
