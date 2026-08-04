import type React from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useUIStore, type CategoryId } from "../stores/uiStore";
import { ChatInput } from "./ChatInput";

const categories: { id: CategoryId; label: string }[] = [
  { id: "daily", label: "日常办公" },
  { id: "coding", label: "编码开发" },
];

const capabilities: Record<CategoryId, { id: string; title: string; desc: string; prompt: string }[]> = {
  daily: [
    {
      id: "ppt",
      title: "PPT 生成",
      desc: "输入主题，自动生成演示文稿大纲与内容",
      prompt: "帮我生成一份关于「主题」的 PPT 大纲",
    },
    {
      id: "doc",
      title: "文档处理",
      desc: "总结、润色、翻译各类文档",
      prompt: "请帮我总结这份文档的核心观点",
    },
  ],
  coding: [
    {
      id: "code-review",
      title: "代码审查",
      desc: "检查代码中的潜在问题与优化点",
      prompt: "请审查以下代码",
    },
    {
      id: "generate-code",
      title: "生成代码",
      desc: "根据需求生成可运行的代码片段",
      prompt: "帮我写一段代码",
    },
  ],
  design: [],
};

const PresentationIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 3h18v14H3z" />
    <path d="M8 21h8" />
    <path d="M12 17v4" />
  </svg>
);

const DocumentIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const CodeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

const BugIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="8" y="6" width="8" height="12" rx="4" />
    <path d="M12 18v4" />
    <path d="M8 22h8" />
    <path d="M4 10h4" />
    <path d="M16 10h4" />
    <path d="M4 14h4" />
    <path d="M16 14h4" />
  </svg>
);

const iconMap: Record<string, React.FC> = {
  ppt: PresentationIcon,
  doc: DocumentIcon,
  "code-review": BugIcon,
  "generate-code": CodeIcon,
};

export function MainView() {
  const { activeCategory, setActiveCategory } = useUIStore();

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      {/* Center content */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-32">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--text-main)]">
          everyBuddy，我帮你
        </h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">选择场景，开始你的下一段任务</p>

        {/* Category tabs */}
        <div className="mt-8 flex gap-2 rounded-full bg-white p-1 shadow-sm">
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className={`rounded-full px-5 py-2 text-sm font-medium transition ${
                activeCategory === cat.id
                  ? "bg-gray-900 text-white shadow"
                  : "text-[var(--text-muted)] hover:bg-gray-100"
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Capability cards */}
        <div className="mt-8 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
          {capabilities[activeCategory].map((cap) => {
            const Icon = iconMap[cap.id] ?? DocumentIcon;
            return (
              <CapabilityCard
                key={cap.id}
                icon={<Icon />}
                title={cap.title}
                desc={cap.desc}
                prompt={cap.prompt}
              />
            );
          })}
        </div>
      </div>

      {/* Input anchored at bottom */}
      <ChatInput />
    </main>
  );
}

interface CapabilityCardProps {
  icon: React.ReactNode;
  title: string;
  desc: string;
  prompt: string;
}

function CapabilityCard({ icon, title, desc, prompt }: CapabilityCardProps) {
  const createSession = useSessionStore((s) => s.createSession);
  const addMessage = useSessionStore((s) => s.addMessage);

  const handleClick = () => {
    const sessionId = createSession(title);
    addMessage(sessionId, {
      id: crypto.randomUUID(),
      role: "user",
      content: prompt,
      timestamp: Date.now(),
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-white p-4 text-left shadow-sm transition hover:border-emerald-300 hover:shadow-md"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
        {icon}
      </div>
      <div>
        <h3 className="font-medium text-[var(--text-main)]">{title}</h3>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">{desc}</p>
      </div>
    </button>
  );
}
