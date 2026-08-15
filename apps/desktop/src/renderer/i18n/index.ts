/**
 * i18n 初始化（仅 renderer）。
 *
 * 主进程与 ipc-contract 只产出稳定翻译 key（见 main/errors.ts 与 translateError.ts），
 * 翻译全部在本实例进行；资源文件经 Vite 静态内联，无运行时 fetch，适配 index.html 严格 CSP。
 */
import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      "zh-CN": { translation: zhCN },
      en: { translation: en },
    },
    fallbackLng: "zh-CN",
    // 必须含基础码 "zh"：nonExplicitSupportedLngs 配合仅含区划码的 supportedLngs 会让
    // 语言解析链为空（languages:[]），导致 t() 全部返回 key。含 "zh" 后兼容
    // navigator.language 为 "zh" / "zh-CN" / "en-US" / "en" 的解析。
    supportedLngs: ["zh", "zh-CN", "en"],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: {
      // localStorage 优先：用户显式选择后覆盖系统语言；首次启动（无缓存）回落 navigator 系统语言
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
    react: { useSuspense: false },
  });

// 同步 <html lang> 与当前语言（a11y）；非浏览器环境（vitest node）跳过
i18n.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
  }
});

/**
 * 归一化到规范语言码：navigator.language 可能是 "zh" / "en-US" 等非精确标签，
 * 统一为 "zh-CN" / "en"，保证语言切换下拉、日期格式与持久化使用稳定值。
 */
i18n.on("initialized", () => {
  const cur = i18n.language;
  const canonical = cur.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  if (cur !== canonical) {
    void i18n.changeLanguage(canonical);
  }
});

export default i18n;
