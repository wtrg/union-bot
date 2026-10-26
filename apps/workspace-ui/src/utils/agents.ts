export interface AgentDef {
  id: string;
  name: string;
  emoji: string;
  role: string;
  colorHex: number;
  earType: "cat" | "star" | "fox" | "bunny" | "leaf" | "koi";
  colorCss: string;
  cardBg: string;
  cardBorder: string;
  angle: number;
  radius: number;
  svg: string;
}

export const AGENTS: Record<string, AgentDef> = {
  ChatGPT: {
    id: "ChatGPT",
    name: "ChatGPT",
    emoji: "🍵",
    role: "Điều Phối Trưởng",
    colorHex: 0x34d399,
    earType: "cat",
    colorCss: "#34D399",
    cardBg: "rgba(16, 185, 129, 0.11)",
    cardBorder: "rgba(52, 211, 153, 0.36)",
    angle: 0.25,
    radius: 5.1,
    svg: '<svg viewBox="0 0 40 40" class="w-full h-full"><circle cx="20" cy="20" r="19" fill="#064E3B" stroke="#34D399" stroke-width="2"/><polygon points="9,16 12,7 18,13" fill="#34D399"/><polygon points="31,16 28,7 22,13" fill="#34D399"/><ellipse cx="20" cy="22" rx="11" ry="9.5" fill="#6EE7B7"/><circle cx="15.5" cy="21" r="1.7" fill="#064E3B"/><circle cx="24.5" cy="21" r="1.7" fill="#064E3B"/><path d="M18 23.5 Q20 25.5 22 23.5" stroke="#064E3B" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
  },
  Gemini: {
    id: "Gemini",
    name: "Gemini",
    emoji: "✨",
    role: "Nghiên cứu",
    colorHex: 0x38bdf8,
    earType: "star",
    colorCss: "#38BDF8",
    cardBg: "rgba(56, 189, 248, 0.13)",
    cardBorder: "rgba(56, 189, 248, 0.42)",
    angle: 1.3,
    radius: 5.1,
    svg: '<svg viewBox="0 0 40 40" class="w-full h-full"><circle cx="20" cy="20" r="19" fill="#0C4A6E" stroke="#38BDF8" stroke-width="2"/><polygon points="10,15 11,6 17,12" fill="#38BDF8"/><polygon points="30,15 29,6 23,12" fill="#38BDF8"/><ellipse cx="20" cy="22" rx="11" ry="9.5" fill="#7DD3FC"/><circle cx="15.5" cy="21" r="1.7" fill="#0C4A6E"/><circle cx="24.5" cy="21" r="1.7" fill="#0C4A6E"/><polygon points="20,9 21.2,11.5 24,12 21.2,12.8 20,15.2 18.8,12.8 16,12 18.8,11.5" fill="#FDE047"/></svg>',
  },
  Codex: {
    id: "Codex",
    name: "Codex",
    emoji: "🦊",
    role: "QA và bảo mật",
    colorHex: 0xfbbf24,
    earType: "fox",
    colorCss: "#FBBF24",
    cardBg: "rgba(245, 158, 11, 0.11)",
    cardBorder: "rgba(251, 191, 36, 0.38)",
    angle: 2.35,
    radius: 5.1,
    svg: '<svg viewBox="0 0 40 40" class="w-full h-full"><circle cx="20" cy="20" r="19" fill="#78350F" stroke="#FBBF24" stroke-width="2"/><polygon points="9,16 11,6 18,13" fill="#F59E0B"/><polygon points="31,16 29,6 22,13" fill="#F59E0B"/><ellipse cx="20" cy="22" rx="11" ry="9.5" fill="#FCD34D"/><circle cx="15.5" cy="21" r="1.7" fill="#1F2937"/><circle cx="24.5" cy="21" r="1.7" fill="#1F2937"/><path d="M17.5 23.5 Q20 26 22.5 23.5" stroke="#1F2937" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
  },
  Antigravity: {
    id: "Antigravity",
    name: "Antigravity",
    emoji: "💠",
    role: "Thực thi và phát triển",
    colorHex: 0x818cf8,
    earType: "bunny",
    colorCss: "#818CF8",
    cardBg: "rgba(99, 102, 241, 0.13)",
    cardBorder: "rgba(129, 140, 248, 0.40)",
    angle: 3.4,
    radius: 5.1,
    svg: '<svg viewBox="0 0 40 40" class="w-full h-full"><circle cx="20" cy="20" r="19" fill="#1E1B4B" stroke="#818CF8" stroke-width="2"/><ellipse cx="15" cy="10" rx="2.5" ry="6.2" fill="#A5B4FC" stroke="#818CF8" stroke-width="1.2"/><ellipse cx="25" cy="10" rx="2.5" ry="6.2" fill="#A5B4FC" stroke="#818CF8" stroke-width="1.2"/><ellipse cx="20" cy="23" rx="11" ry="9" fill="#C7D2FE"/><circle cx="15.5" cy="22" r="1.7" fill="#1E1B4B"/><circle cx="24.5" cy="22" r="1.7" fill="#1E1B4B"/><path d="M18.2 24 Q20 25.8 21.8 24" stroke="#1E1B4B" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>',
  },
  Claude: {
    id: "Claude",
    name: "Claude",
    emoji: "🍊",
    role: "Review",
    colorHex: 0xfb923c,
    earType: "leaf",
    colorCss: "#FB923C",
    cardBg: "rgba(249, 115, 22, 0.11)",
    cardBorder: "rgba(251, 146, 60, 0.36)",
    angle: 4.45,
    radius: 5.1,
    svg: '<svg viewBox="0 0 40 40" class="w-full h-full"><circle cx="20" cy="20" r="19" fill="#7C2D12" stroke="#FB923C" stroke-width="2"/><ellipse cx="20" cy="22" rx="11" ry="9.5" fill="#FDBA74"/><path d="M20 12 Q25 8 27 12 Q23 15 20 12Z" fill="#34D399"/><circle cx="15.5" cy="21.5" r="1.7" fill="#1F2937"/><circle cx="24.5" cy="21.5" r="1.7" fill="#1F2937"/><path d="M18 24 Q20 25.5 22 24" stroke="#1F2937" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
  },
  DeepSeek: {
    id: "DeepSeek",
    name: "DeepSeek",
    emoji: "🐟",
    role: "Review",
    colorHex: 0x60a5fa,
    earType: "koi",
    colorCss: "#60A5FA",
    cardBg: "rgba(37, 99, 235, 0.14)",
    cardBorder: "rgba(96, 165, 250, 0.42)",
    angle: 5.5,
    radius: 5.1,
    svg: '<svg viewBox="0 0 40 40" class="w-full h-full"><circle cx="20" cy="20" r="19" fill="#1E3A8A" stroke="#60A5FA" stroke-width="2"/><ellipse cx="20" cy="22" rx="11" ry="9.5" fill="#93C5FD"/><circle cx="20" cy="15.5" r="2.2" fill="#38BDF8"/><circle cx="15.5" cy="21.5" r="1.7" fill="#1E3A8A"/><circle cx="24.5" cy="21.5" r="1.7" fill="#1E3A8A"/><path d="M18 24 Q20 25.8 22 24" stroke="#1E3A8A" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
  },
  Commander: {
    id: "Commander",
    name: "Bạn (Commander)",
    emoji: "👑",
    role: "Chủ Dự Án",
    colorHex: 0x38bdf8,
    earType: "cat",
    colorCss: "#38BDF8",
    cardBg: "rgba(2, 132, 199, 0.24)",
    cardBorder: "rgba(56, 189, 248, 0.55)",
    angle: 0,
    radius: 0,
    svg: '<svg viewBox="0 0 40 40" class="w-full h-full"><circle cx="20" cy="20" r="19" fill="#0284C7" stroke="#7DD3FC" stroke-width="2"/><path d="M11 26L14 14L20 20L26 14L29 26H11Z" fill="#E0F2FE"/></svg>',
  },
};

export const AGENT_IDS = [
  "ChatGPT",
  "Gemini",
  "Codex",
  "Antigravity",
  "Claude",
  "DeepSeek",
];
