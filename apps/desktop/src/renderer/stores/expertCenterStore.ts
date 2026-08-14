/**
 * expertCenterStore - 专家·技能·连接器 状态（Zustand）。
 * 四个实体各持列表，CRUD 经 window.electronAPI 主进程持久化，成功后本地同步。
 */

import type {
  Connector,
  ConnectorTestResult,
  CreateConnectorRequest,
  CreateExpertRequest,
  CreateSkillRequest,
  CreateTeamRequest,
  Expert,
  ExpertTeam,
  SkillEntry,
  UpdateConnectorRequest,
  UpdateExpertRequest,
  UpdateSkillRequest,
  UpdateTeamRequest,
} from "@everybuddy/ipc-contract";
import { create } from "zustand";

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx < 0) return [item, ...list];
  const next = [...list];
  next[idx] = item;
  return next;
}

interface ExpertCenterState {
  experts: Expert[];
  teams: ExpertTeam[];
  skills: SkillEntry[];
  connectors: Connector[];
  loaded: boolean;

  loadAll: () => Promise<void>;

  // 专家
  createExpert: (req: CreateExpertRequest) => Promise<Expert>;
  updateExpert: (req: UpdateExpertRequest) => Promise<Expert>;
  deleteExpert: (id: string) => Promise<void>;

  // 专家团
  createTeam: (req: CreateTeamRequest) => Promise<ExpertTeam>;
  updateTeam: (req: UpdateTeamRequest) => Promise<ExpertTeam>;
  deleteTeam: (id: string) => Promise<void>;

  // 技能
  createSkill: (req: CreateSkillRequest) => Promise<SkillEntry>;
  updateSkill: (req: UpdateSkillRequest) => Promise<SkillEntry>;
  installSkill: (sourcePath: string) => Promise<SkillEntry>;
  uninstallSkill: (id: string) => Promise<void>;
  enableSkill: (id: string, enabled: boolean) => Promise<void>;

  // 连接器
  createConnector: (req: CreateConnectorRequest) => Promise<Connector>;
  updateConnector: (req: UpdateConnectorRequest) => Promise<Connector>;
  deleteConnector: (id: string) => Promise<void>;
  testConnector: (id: string) => Promise<ConnectorTestResult>;
}

export const useExpertCenterStore = create<ExpertCenterState>((set) => ({
  experts: [],
  teams: [],
  skills: [],
  connectors: [],
  loaded: false,

  loadAll: async () => {
    const [experts, teams, skills, connectors] = await Promise.all([
      window.electronAPI.expert.list(),
      window.electronAPI.team.list(),
      window.electronAPI.skill.list(),
      window.electronAPI.connector.list(),
    ]);
    set({ experts, teams, skills, connectors, loaded: true });
  },

  createExpert: async (req) => {
    const expert = await window.electronAPI.expert.create(req);
    set((s) => ({ experts: upsert(s.experts, expert) }));
    return expert;
  },
  updateExpert: async (req) => {
    const expert = await window.electronAPI.expert.update(req);
    set((s) => ({ experts: upsert(s.experts, expert) }));
    return expert;
  },
  deleteExpert: async (id) => {
    await window.electronAPI.expert.delete(id);
    set((s) => ({ experts: s.experts.filter((e) => e.id !== id) }));
  },

  createTeam: async (req) => {
    const team = await window.electronAPI.team.create(req);
    set((s) => ({ teams: upsert(s.teams, team) }));
    return team;
  },
  updateTeam: async (req) => {
    const team = await window.electronAPI.team.update(req);
    set((s) => ({ teams: upsert(s.teams, team) }));
    return team;
  },
  deleteTeam: async (id) => {
    await window.electronAPI.team.delete(id);
    set((s) => ({ teams: s.teams.filter((t) => t.id !== id) }));
  },

  createSkill: async (req) => {
    const skill = await window.electronAPI.skill.create(req);
    set((s) => ({ skills: upsert(s.skills, skill) }));
    return skill;
  },
  updateSkill: async (req) => {
    const skill = await window.electronAPI.skill.update(req);
    set((s) => ({ skills: upsert(s.skills, skill) }));
    return skill;
  },
  installSkill: async (sourcePath) => {
    const skill = await window.electronAPI.skill.install({ sourcePath });
    set((s) => ({ skills: upsert(s.skills, skill) }));
    return skill;
  },
  uninstallSkill: async (id) => {
    await window.electronAPI.skill.uninstall(id);
    set((s) => ({ skills: s.skills.filter((x) => x.id !== id) }));
  },
  enableSkill: async (id, enabled) => {
    await window.electronAPI.skill.enable({ id, enabled });
    set((s) => ({ skills: s.skills.map((x) => (x.id === id ? { ...x, enabled } : x)) }));
  },

  createConnector: async (req) => {
    const connector = await window.electronAPI.connector.create(req);
    set((s) => ({ connectors: upsert(s.connectors, connector) }));
    return connector;
  },
  updateConnector: async (req) => {
    const connector = await window.electronAPI.connector.update(req);
    set((s) => ({ connectors: upsert(s.connectors, connector) }));
    return connector;
  },
  deleteConnector: async (id) => {
    await window.electronAPI.connector.delete(id);
    set((s) => ({ connectors: s.connectors.filter((c) => c.id !== id) }));
  },
  testConnector: async (id) => {
    const result = await window.electronAPI.connector.test({ id });
    // 测试会更新主进程 status/lastTools；本地同步（capabilities 由主进程自动检测）
    if (result.status !== "reserved") {
      set((s) => ({
        connectors: s.connectors.map((c) =>
          c.id === id
            ? { ...c, status: result.status, lastTools: result.toolNames ?? c.lastTools }
            : c,
        ),
      }));
    }
    return result;
  },
}));
