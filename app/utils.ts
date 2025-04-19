import { useEffect, useState } from "react";
import { showToast } from "./components/ui-lib";
import Locale, { getLang } from "./locales";
import { MultimodalContent, RequestMessage } from "./client/api";
import {
  DEFAULT_MODELS,
  REQUEST_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS_FOR_IMAGE_GENERATION,
  REQUEST_TIMEOUT_MS_FOR_THINKING,
} from "./constant";
import { ServiceProvider } from "./constant";
// import { fetch as tauriFetch, ResponseType } from "@tauri-apps/api/http";
import { fetch as tauriStreamFetch } from "./utils/stream";
import {
  WEB_SEARCH_ANSWER_EN_PROMPT,
  WEB_SEARCH_ANSWER_ZH_PROMPT,
} from "./prompt";

export function trimTopic(topic: string) {
  // Fix an issue where double quotes still show in the Indonesian language
  // This will remove the specified punctuation from the end of the string
  // and also trim quotes from both the start and end if they exist.
  return (
    topic
      // fix for gemini
      .replace(/^["“”*]+|["“”*]+$/g, "")
      .replace(/[，。！？”“"、,.!?*]*$/, "")
  );
}

export async function copyToClipboard(text: string) {
  try {
    if (window.__TAURI__) {
      window.__TAURI__.writeText(text);
    } else {
      await navigator.clipboard.writeText(text);
    }

    showToast(Locale.Copy.Success);
  } catch (error) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand("copy");
      showToast(Locale.Copy.Success);
    } catch (error) {
      showToast(Locale.Copy.Failed);
    }
    document.body.removeChild(textArea);
  }
}

export async function downloadAs(text: string, filename: string) {
  if (window.__TAURI__) {
    const result = await window.__TAURI__.dialog.save({
      defaultPath: `${filename}`,
      filters: [
        {
          name: `${filename.split(".").pop()} files`,
          extensions: [`${filename.split(".").pop()}`],
        },
        {
          name: "All Files",
          extensions: ["*"],
        },
      ],
    });

    if (result !== null) {
      try {
        await window.__TAURI__.fs.writeTextFile(result, text);
        showToast(Locale.Download.Success);
      } catch (error) {
        showToast(Locale.Download.Failed);
      }
    } else {
      showToast(Locale.Download.Failed);
    }
  } else {
    const element = document.createElement("a");
    element.setAttribute(
      "href",
      "data:text/plain;charset=utf-8," + encodeURIComponent(text),
    );
    element.setAttribute("download", filename);

    element.style.display = "none";
    document.body.appendChild(element);

    element.click();

    document.body.removeChild(element);
  }
}

export function readFromFile() {
  return new Promise<string>((res, rej) => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "application/json";

    fileInput.onchange = (event: any) => {
      const file = event.target.files[0];
      const fileReader = new FileReader();
      fileReader.onload = (e: any) => {
        res(e.target.result);
      };
      fileReader.onerror = (e) => rej(e);
      fileReader.readAsText(file);
    };

    fileInput.click();
  });
}

export function isIOS() {
  const userAgent = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(userAgent);
}

export function useWindowSize() {
  const [size, setSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    const onResize = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return size;
}

export const MOBILE_MAX_WIDTH = 600;
export function useMobileScreen() {
  const { width } = useWindowSize();

  return width <= MOBILE_MAX_WIDTH;
}

export function isFirefox() {
  return (
    typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent)
  );
}

export function selectOrCopy(el: HTMLElement, content: string) {
  const currentSelection = window.getSelection();

  if (currentSelection?.type === "Range") {
    return false;
  }

  copyToClipboard(content);

  return true;
}

function getDomContentWidth(dom: HTMLElement) {
  const style = window.getComputedStyle(dom);
  const paddingWidth =
    parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const width = dom.clientWidth - paddingWidth;
  return width;
}

function getOrCreateMeasureDom(id: string, init?: (dom: HTMLElement) => void) {
  let dom = document.getElementById(id);

  if (!dom) {
    dom = document.createElement("span");
    dom.style.position = "absolute";
    dom.style.wordBreak = "break-word";
    dom.style.fontSize = "14px";
    dom.style.transform = "translateY(-200vh)";
    dom.style.pointerEvents = "none";
    dom.style.opacity = "0";
    dom.id = id;
    document.body.appendChild(dom);
    init?.(dom);
  }

  return dom!;
}

export function autoGrowTextArea(dom: HTMLTextAreaElement) {
  const measureDom = getOrCreateMeasureDom("__measure");
  const singleLineDom = getOrCreateMeasureDom("__single_measure", (dom) => {
    dom.innerText = "TEXT_FOR_MEASURE";
  });

  const width = getDomContentWidth(dom);
  measureDom.style.width = width + "px";
  measureDom.innerText = dom.value !== "" ? dom.value : "1";
  measureDom.style.fontSize = dom.style.fontSize;
  measureDom.style.fontFamily = dom.style.fontFamily;
  const endWithEmptyLine = dom.value.endsWith("\n");
  const height = parseFloat(window.getComputedStyle(measureDom).height);
  const singleLineHeight = parseFloat(
    window.getComputedStyle(singleLineDom).height,
  );

  const rows =
    Math.round(height / singleLineHeight) + (endWithEmptyLine ? 1 : 0);

  return rows;
}

export function getCSSVar(varName: string) {
  return getComputedStyle(document.body).getPropertyValue(varName).trim();
}

/**
 * Detects Macintosh
 */
export function isMacOS(): boolean {
  if (typeof window !== "undefined") {
    let userAgent = window.navigator.userAgent.toLocaleLowerCase();
    const macintosh = /iphone|ipad|ipod|macintosh/.test(userAgent);
    return !!macintosh;
  }
  return false;
}

export function getWebReferenceMessageTextContent(message: RequestMessage) {
  let prompt = getMessageTextContent(message);
  if (
    message.webSearchReferences &&
    message.webSearchReferences.results.length > 0
  ) {
    const searchResults = message.webSearchReferences.results
      .map((result, index) => {
        return `[webpage ${index + 1} begin]
[webpage title]${result.title}
[webpage url]${result.url}
[webpage content begin]
${result.content}
[webpage content end]
[webpage ${index + 1} end]
`;
      })
      .join("\n");
    const isZh = getLang() == "cn";
    const promptTemplate = isZh
      ? WEB_SEARCH_ANSWER_ZH_PROMPT
      : WEB_SEARCH_ANSWER_EN_PROMPT;
    prompt = promptTemplate
      .replace("{cur_date}", new Date().toLocaleString())
      .replace("{search_results}", searchResults)
      .replace("{question}", prompt);
  }
  return prompt;
}

export function getMessageTextContent(message: RequestMessage) {
  return getTextContent(message.content);
}

export function getTextContent(content: string | MultimodalContent[]) {
  if (typeof content === "string") {
    return content;
  }
  let combinedText = "";
  for (const c of content) {
    if (c.type === "text") {
      combinedText += (c.text ?? "") + " ";
    }
  }
  return combinedText.trim();
}

export function getMessageTextContentWithoutThinking(message: RequestMessage) {
  let content = "";

  if (typeof message.content === "string") {
    content = message.content;
  } else {
    for (const c of message.content) {
      if (c.type === "text") {
        content = c.text ?? "";
        break;
      }
    }
  }

  // Filter out thinking lines (starting with "> ")
  return content
    .split("\n")
    .filter((line) => !line.startsWith("> ") && line.trim() !== "")
    .join("\n")
    .trim();
}

export function getMessageImages(message: RequestMessage): string[] {
  if (typeof message.content === "string") {
    return [];
  }
  const urls: string[] = [];
  for (const c of message.content) {
    if (c.type === "image_url") {
      urls.push(c.image_url?.url ?? "");
    }
  }
  return urls;
}

export function isVisionModel(model: string) {
  // Note: This is a better way using the TypeScript feature instead of `&&` or `||` (ts v5.5.0-dev.20240314 I've been using)

  const visionKeywords = [
    "vision",
    "claude-3",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
    "gemini-exp-1114",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.5-preview",
    "gpt-4.5-preview-2025-02-27",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-4.1-2025-04-14",
    "o1","o3",
    "o4-mini-2025-04-16",
  ];

  var googleModels = DEFAULT_MODELS.filter(
    (model) => model.provider.id === "google",
  ).map((model) => model.name);

  const isGpt4Turbo =
    model.includes("gpt-4-turbo") && !model.includes("preview");

  return (
    visionKeywords.some((keyword) => model.includes(keyword)) ||
    isGpt4Turbo ||
    isDalle3(model) ||
    googleModels.some((keyword) => model.includes(keyword))
  );
}

export function isDalle3(model: string) {
  return "dall-e-3" === model;
}

export function getTimeoutMSByModel(model: string) {
  model = model.toLowerCase();
  if (model.startsWith("gemini-2.0-flash-exp")) {
    return REQUEST_TIMEOUT_MS_FOR_IMAGE_GENERATION;
  }
  if (
    model.startsWith("dall-e") ||
    model.startsWith("dalle") ||
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.includes("deepseek-r") ||
    model.includes("-thinking")
  )
    return REQUEST_TIMEOUT_MS_FOR_THINKING;
  return REQUEST_TIMEOUT_MS;
}

export function showPlugins(provider: ServiceProvider, model: string) {
  if (
    provider == ServiceProvider.OpenAI ||
    provider == ServiceProvider.Azure ||
    provider == ServiceProvider.Moonshot ||
    provider == ServiceProvider.ChatGLM
  ) {
    return true;
  }
  if (provider == ServiceProvider.Anthropic && !model.includes("claude-2")) {
    return true;
  }
  if (provider == ServiceProvider.Google && !model.includes("vision")) {
    return true;
  }
  return false;
}

export function isSupportRAGModel(modelName: string) {
  const specialModels = [
    "gpt-4-turbo",
    "gpt-4-turbo-2024-04-09",
    "gpt-4o",
    "gpt-4o-2024-05-13",
    "gpt-4o-mini",
    "gpt-4o-mini-2024-07-18",
    "gpt-4.5-preview",
    "gpt-4.5-preview-2025-02-27",
  ];
  if (specialModels.some((keyword) => modelName === keyword)) return true;
  if (isVisionModel(modelName)) return false;
  return DEFAULT_MODELS.filter((model) => model.provider.id === "openai").some(
    (model) => model.name === modelName,
  );
}

export function isFunctionCallModel(modelName: string) {
  if (isDalle3(modelName)) {
    return false;
  }
  const specialModels = [
    "gpt-3.5-turbo",
    "gpt-3.5-turbo-1106",
    "gpt-3.5-turbo-0125",
    "gpt-4",
    "gpt-4-0613",
    "gpt-4-32k",
    "gpt-4-32k-0613",
    "gpt-4-turbo",
    "gpt-4-turbo-preview",
    "gpt-4o",
    "gpt-4o-2024-05-13",
    "gpt-4o-mini",
    "gpt-4o-mini-2024-07-18",
    "gpt-4-turbo-2024-04-09",
    "gpt-4-1106-preview",
    "gpt-4.5-preview",
    "gpt-4.5-preview-2025-02-27",
    "claude-3-sonnet-20240229",
    "claude-3-opus-20240229",
    "claude-3-haiku-20240307",
    "claude-3-5-sonnet-20240620",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-7-sonnet-20250219",
    "claude-3-7-sonnet-latest",
    "gpt-4.1-2025-04-14",
    "o1","o3",
    "o4-mini-2025-04-16",
  ];
  if (specialModels.some((keyword) => modelName === keyword)) return true;
  return DEFAULT_MODELS.filter(
    (model) => model.provider.id === "openai" && !model.name.includes("o2"),
  ).some((model) => model.name === modelName);
}

export function isClaudeThinkingModel(modelName: string) {
  const specialModels = [
    "claude-3-7-sonnet-20250219",
    "claude-3-7-sonnet-latest",
  ];
  return specialModels.some((keyword) => modelName === keyword);
}

export function isImageGenerationModel(modelName: string) {
  const specialModels = ["gemini-2.0-flash-exp"];
  return specialModels.some((keyword) => modelName === keyword);
}

export function fetch(
  url: string,
  options?: Record<string, unknown>,
): Promise<any> {
  if (window.__TAURI__) {
    return tauriStreamFetch(url, options);
  }
  return window.fetch(url, options);
}

export function adapter(config: Record<string, unknown>) {
  const { baseURL, url, params, data: body, ...rest } = config;
  const path = baseURL ? `${baseURL}${url}` : url;
  const fetchUrl = params
    ? `${path}?${new URLSearchParams(params as any).toString()}`
    : path;
  return fetch(fetchUrl as string, { ...rest, body }).then((res) => {
    const { status, headers, statusText } = res;
    return res
      .text()
      .then((data: string) => ({ status, statusText, headers, data }));
  });
}

export function safeLocalStorage(): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
} {
  let storage: Storage | null;

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      storage = window.localStorage;
    } else {
      storage = null;
    }
  } catch (e) {
    console.error("localStorage is not available:", e);
    storage = null;
  }

  return {
    getItem(key: string): string | null {
      if (storage) {
        return storage.getItem(key);
      } else {
        console.warn(
          `Attempted to get item "${key}" from localStorage, but localStorage is not available.`,
        );
        return null;
      }
    },
    setItem(key: string, value: string): void {
      if (storage) {
        storage.setItem(key, value);
      } else {
        console.warn(
          `Attempted to set item "${key}" in localStorage, but localStorage is not available.`,
        );
      }
    },
    removeItem(key: string): void {
      if (storage) {
        storage.removeItem(key);
      } else {
        console.warn(
          `Attempted to remove item "${key}" from localStorage, but localStorage is not available.`,
        );
      }
    },
    clear(): void {
      if (storage) {
        storage.clear();
      } else {
        console.warn(
          "Attempted to clear localStorage, but localStorage is not available.",
        );
      }
    },
  };
}

export function getOperationId(operation: {
  operationId?: string;
  method: string;
  path: string;
}) {
  // pattern '^[a-zA-Z0-9_-]+$'
  return (
    operation?.operationId ||
    `${operation.method.toUpperCase()}${operation.path.replaceAll("/", "_")}`
  );
}

export function clientUpdate() {
  // this a wild for updating client app
  return window.__TAURI__?.updater
    .checkUpdate()
    .then((updateResult) => {
      if (updateResult.shouldUpdate) {
        window.__TAURI__?.updater
          .installUpdate()
          .then((result) => {
            showToast(Locale.Settings.Update.Success);
          })
          .catch((e) => {
            console.error("[Install Update Error]", e);
            showToast(Locale.Settings.Update.Failed);
          });
      }
    })
    .catch((e) => {
      console.error("[Check Update Error]", e);
      showToast(Locale.Settings.Update.Failed);
    });
}

// https://gist.github.com/iwill/a83038623ba4fef6abb9efca87ae9ccb
export function semverCompare(a: string, b: string) {
  if (a.startsWith(b + "-")) return -1;
  if (b.startsWith(a + "-")) return 1;
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "case",
    caseFirst: "upper",
  });
}
