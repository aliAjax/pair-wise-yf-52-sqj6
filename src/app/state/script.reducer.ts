import { createReducer, on } from '@ngrx/store';
import {
  addQuestion,
  addVersion,
  activateVersion,
  publishVersion,
  reorderLines,
  resendQuestion,
  resetScenario,
  reviewCue,
  reviewLine,
  setOnline,
  submitPlaywrightDraft,
  syncQuestions,
  toggleRehearsal,
  toggleSimulateFailure,
} from './script.actions';

export type CueDecision = 'pending' | 'accepted' | 'returned';
export type QuestionStatus =
  | 'pending' // 已在本地标记，尚未回传
  | 'failed' // 合并失败，保留在队列中等待重试
  | 'rebased' // 编剧改了文字：疑问已落到新文字，旧文字留存备查
  | 'suspended'; // 编剧撤下了该台词/提示：疑问挂起列出，不进入正文

export interface ScriptLine {
  id: string;
  role: string;
  text: string;
  status: 'pending' | 'accepted' | 'returned';
}

export interface ScriptCue {
  id: string;
  scene: string;
  text: string;
  status: CueDecision;
}

export interface ScriptVersion {
  id: string;
  label: string;
  playwright: string;
  note: string;
  published?: boolean;
  lines: ScriptLine[];
  cues: ScriptCue[];
}

export interface Question {
  id: string; // 幂等键：同一条疑问重复回传只算一次
  actor: string;
  target: 'line' | 'cue';
  targetId: string;
  versionId: string; // 标记时所依据的已发布版本
  note: string;
  status: QuestionStatus;
  /** 标记时的正文快照，rebase / 挂起后留旧文字备查 */
  snapshotRole?: string;
  snapshotScene?: string;
  snapshotText: string;
  anchoredVersionId?: string; // 合并后疑问实际落在哪一版（下一版）
  syncedAt?: number;
}

export interface OutboxEntry {
  id: string;
  questionId: string;
  attempts: number;
  lastError?: string;
  queuedAt: number;
}

export interface SyncLogEntry {
  id: string;
  at: number;
  summary: string;
  details: string[];
}

export interface ScriptState {
  versions: ScriptVersion[];
  activeVersionId: string;
  rehearsalMode: boolean;
  online: boolean;
  questions: Question[];
  outbox: OutboxEntry[];
  syncLog: SyncLogEntry[];
  simulateFailure: boolean;
}

const v12: ScriptVersion = {
  id: 'v12',
  label: '排练稿 v12（舞台监督已发布）',
  playwright: '林编剧',
  note: '重写第三场父女冲突，舞台灯光提示延后2拍。',
  published: true,
  lines: [
    { id: 'l1', role: '周岚', text: '你每次都说等明天，可舞台不会等我们。', status: 'pending' },
    { id: 'l2', role: '周野', text: '那就让灯灭吧，我早已背熟黑暗。', status: 'pending' },
  ],
  cues: [
    { id: 'c1', scene: '第三场', text: '侧灯收至30%，雨声渐入', status: 'pending' },
    { id: 'c2', scene: '第三场', text: '周野坐到舞台左前区，保留两拍静默', status: 'accepted' },
  ],
};

const v13: ScriptVersion = {
  id: 'v13',
  label: '导演修订 v13',
  playwright: '林编剧',
  note: '调整周岚结论，加入一次性追光变化。',
  lines: [
    { id: 'l1', role: '周岚', text: '你总说明天，但今晚我们必须把话说完。', status: 'pending' },
    { id: 'l3', role: '周岚', text: '看着灯，再说一次你为什么回来。', status: 'pending' },
  ],
  cues: [{ id: 'c3', scene: '第三场', text: '追光由冷白切换至琥珀，等待雨声下落', status: 'pending' }],
};

/** 断网一周：演员们在已发布的 v12 上背词，本地标出 4 条疑问 */
function seedQuestions(): Question[] {
  const snap = (target: 'line' | 'cue', targetId: string) => {
    const item =
      target === 'line'
        ? v12.lines.find((line) => line.id === targetId)
        : v12.cues.find((cue) => cue.id === targetId);
    const line = target === 'line' ? (item as ScriptLine | undefined) : undefined;
    const cue = target === 'cue' ? (item as ScriptCue | undefined) : undefined;
    return { snapshotRole: line?.role, snapshotScene: cue?.scene, snapshotText: item?.text ?? '' };
  };
  const make = (
    id: string,
    actor: string,
    target: 'line' | 'cue',
    targetId: string,
    note: string
  ): Question => ({ id, actor, target, targetId, versionId: 'v12', note, status: 'pending', ...snap(target, targetId) });
  return [
    make('q1', '周野（演员）', 'line', 'l1', '“等明天”这句重音落在哪个字？和前一场情绪怎么接？'),
    make('q2', '周野（演员）', 'line', 'l2', '“背熟黑暗”是念得更轻还是更狠？'),
    make('q3', '场记代标', 'cue', 'c1', '侧灯30%是在句前还是句后？'),
    make('q4', '场记代标', 'cue', 'c2', '两拍静默期间能否有呼吸声？'),
  ];
}

function seedOutbox(): OutboxEntry[] {
  const at = Date.now() - 60_000;
  return [
    { id: 'ob1', questionId: 'q1', attempts: 0, queuedAt: at },
    { id: 'ob2', questionId: 'q2', attempts: 0, queuedAt: at + 1_000 },
    { id: 'ob3', questionId: 'q3', attempts: 0, queuedAt: at + 2_000 },
    // q4 在弱网下被演员点了两次：重复回传，合并时只算一次
    { id: 'ob4', questionId: 'q4', attempts: 0, queuedAt: at + 3_000 },
    { id: 'ob5', questionId: 'q4', attempts: 0, queuedAt: at + 4_000 },
  ];
}

export function initialScenario(): ScriptState {
  return {
    versions: [v12, v13],
    activeVersionId: 'v12',
    rehearsalMode: false,
    online: false,
    questions: seedQuestions(),
    outbox: seedOutbox(),
    syncLog: [],
    simulateFailure: true,
  };
}

function getInitialState(): ScriptState {
  if (typeof localStorage === 'undefined') return initialScenario();
  const saved = localStorage.getItem('yf52-script-state-v2');
  return saved ? (JSON.parse(saved) as ScriptState) : initialScenario();
}

/** 编剧刚提交的下一版：l1 改字、c1 改字（疑问需落到新文字）；l2、c2 被撤下（疑问挂起） */
export function playwrightDraftV14(): ScriptVersion {
  return {
    id: 'v14',
    label: '编剧修订 v14（下一版）',
    playwright: '林编剧',
    note: '回网后提交：改写 l1 台词与 c1 灯光提示；撤下 l2 与 c2。',
    lines: [
      { id: 'l1', role: '周岚', text: '你总说等明天——可今晚，舞台不会再等任何人。', status: 'pending' },
      { id: 'l3', role: '周岚', text: '看着灯，再说一次你为什么回来。', status: 'pending' },
    ],
    cues: [{ id: 'c1', scene: '第三场', text: '侧灯收至20%，句中雨声渐入，延后两拍', status: 'pending' }],
  };
}

function latestDraft(versions: ScriptVersion[]): ScriptVersion | undefined {
  return [...versions].reverse().find((version) => !version.published);
}

/**
 * 回网合并：疑问只锚定到最新的未发布版本（下一版）。
 * - 目标仍在且文字被编剧修改 / 未变 → rebased：落到新文字，旧文字随疑问留存
 * - 目标台词/提示被撤下 → suspended：挂起列出
 * 已发布版本不收离线改动。
 */
function resolveQuestion(question: Question, draft: ScriptVersion): Question {
  const items = question.target === 'line' ? draft.lines : draft.cues;
  const fresh = items.find((item) => item.id === question.targetId);
  const status: QuestionStatus = fresh ? 'rebased' : 'suspended';
  return { ...question, status, anchoredVersionId: draft.id, syncedAt: Date.now() };
}

export const scriptReducer = createReducer(
  getInitialState(),
  on(resetScenario, () => initialScenario()),

  on(addVersion, (state, { version }) => ({ ...state, versions: [...state.versions, version] })),
  on(submitPlaywrightDraft, (state, { version }) =>
    state.versions.some((item) => item.id === version.id)
      ? state
      : { ...state, versions: [...state.versions, version] }
  ),
  on(activateVersion, (state, { id }) => ({ ...state, activeVersionId: id })),
  on(publishVersion, (state, { id }) => ({
    ...state,
    versions: state.versions.map((version) => (version.id === id ? { ...version, published: true } : version)),
  })),
  // 已发布版本冻结：正文采纳/退回只作用于未发布版本
  on(reviewLine, (state, { id, decision }) => ({
    ...state,
    versions: state.versions.map((version) =>
      version.id !== state.activeVersionId || version.published
        ? version
        : { ...version, lines: version.lines.map((line) => (line.id === id ? { ...line, status: decision } : line)) }
    ),
  })),
  on(reorderLines, (state, { from, to }) => ({
    ...state,
    versions: state.versions.map((version) => {
      if (version.id !== state.activeVersionId || version.published || from === to) return version;
      const lines = [...version.lines];
      const [moved] = lines.splice(from, 1);
      lines.splice(to, 0, moved);
      return { ...version, lines };
    }),
  })),
  on(reviewCue, (state, { id, decision }) => ({
    ...state,
    versions: state.versions.map((version) =>
      version.id !== state.activeVersionId || version.published
        ? version
        : { ...version, cues: version.cues.map((cue) => (cue.id === id ? { ...cue, status: decision } : cue)) }
    ),
  })),
  on(toggleRehearsal, (state) => ({ ...state, rehearsalMode: !state.rehearsalMode })),
  on(setOnline, (state, { online }) => ({ ...state, online })),
  on(toggleSimulateFailure, (state) => ({ ...state, simulateFailure: !state.simulateFailure })),

  // 演员只标疑问、不动正文。离线（或在已发布版本上标记）先进 outbox 等待回传
  on(addQuestion, (state, { id, target, targetId, versionId, note, actor }) => {
    if (state.questions.some((item) => item.id === id)) return state;
    const version = state.versions.find((item) => item.id === versionId);
    if (!version) return state;
    const found = (target === 'line' ? version.lines : version.cues).find((item) => item.id === targetId);
    if (!found) return state;
    const line = target === 'line' ? (found as ScriptLine) : undefined;
    const cue = target === 'cue' ? (found as ScriptCue) : undefined;
    const question: Question = {
      id,
      actor,
      target,
      targetId,
      versionId,
      note,
      status: 'pending',
      snapshotRole: line?.role,
      snapshotScene: cue?.scene,
      snapshotText: found.text,
    };
    const queue = (next: ScriptState): ScriptState => ({
      ...next,
      questions: [...next.questions, question],
      outbox: [...next.outbox, { id: `ob-${id}-${Date.now()}`, questionId: id, attempts: 0, queuedAt: Date.now() }],
    });
    if (!state.online || version.published) return queue(state);
    const draft = latestDraft(state.versions);
    if (!draft) return queue(state);
    // 在线且看的是草稿：疑问立即落到草稿
    return { ...state, questions: [...state.questions, resolveQuestion(question, draft)] };
  }),

  // 重复回传同一条疑问：再排进 outbox，合并时按 questionId 幂等去重
  on(resendQuestion, (state, { questionId }) => {
    if (!state.questions.some((item) => item.id === questionId)) return state;
    return {
      ...state,
      outbox: [
        ...state.outbox,
        { id: `ob-resend-${questionId}-${Date.now()}`, questionId, attempts: 0, queuedAt: Date.now() },
      ],
    };
  }),

  // 回网合并：只处理还没合完的那批（pending/failed）；已合并的重复条目跳过，只算一次。
  // 首批可模拟后半批失败：失败条目留 outbox，重试时只重试这批残留。
  on(syncQuestions, (state, { failHalf }) => {
    if (!state.online) return state;
    const draft = latestDraft(state.versions);
    const simulate = failHalf ?? state.simulateFailure;
    const details: string[] = [];

    // 本批首次尝试（attempts===0）的待处理条目（按 questionId 去重后的处理顺序），
    // 用于让「前半成功、后半失败」稳定可复现；重复回传条目不参与分界。
    const firstWaveIds: string[] = [];
    for (const entry of state.outbox) {
      if (
        entry.attempts === 0 &&
        !firstWaveIds.includes(entry.questionId) &&
        state.questions.some((q) => q.id === entry.questionId && (q.status === 'pending' || q.status === 'failed'))
      ) {
        firstWaveIds.push(entry.questionId);
      }
    }
    const failCutoff = simulate && firstWaveIds.length > 1 ? Math.ceil(firstWaveIds.length / 2) : Number.POSITIVE_INFINITY;

    const seen = new Set<string>();
    const survivors: OutboxEntry[] = [];
    let questions = state.questions;
    let merged = 0;
    let failed = 0;
    let duplicates = 0;

    for (const entry of state.outbox) {
      if (seen.has(entry.questionId)) {
        duplicates += 1;
        details.push(`重复回传：${entry.questionId} 已受理/已合并，本条只算一次，丢弃（${entry.id}）`);
        continue;
      }
      const question = questions.find((item) => item.id === entry.questionId);
      if (!question || question.status === 'rebased' || question.status === 'suspended') {
        duplicates += 1;
        if (question) details.push(`幂等跳过：${question.id} 已合并（${question.status}），重复回传只算一次（${entry.id}）`);
        continue;
      }
      seen.add(entry.questionId);

      const waveIndex = firstWaveIds.indexOf(entry.questionId);
      const inFirstWave = waveIndex !== -1;
      const forceFail = inFirstWave && waveIndex + 1 > failCutoff;

      if (!draft) {
        failed += 1;
        survivors.push({ ...entry, attempts: entry.attempts + 1, lastError: '没有可承接的下一版草稿' });
        continue;
      }
      if (forceFail) {
        failed += 1;
        survivors.push({ ...entry, attempts: entry.attempts + 1, lastError: '合并服务超时（模拟）' });
        questions = questions.map((item) =>
          item.id === question.id ? { ...item, status: 'failed' as QuestionStatus } : item
        );
        details.push(`合并失败：${question.id}「${question.note.slice(0, 10)}…」留队，稍后重试`);
        continue;
      }

      const resolved = resolveQuestion(question, draft);
      questions = questions.map((item) => (item.id === question.id ? resolved : item));
      merged += 1;
      details.push(
        resolved.status === 'suspended'
          ? `挂起：${question.id} 针对的${question.target === 'line' ? '台词' : '舞台提示'}已被编剧撤下，挂起列出 → ${draft.id}`
          : `转挂新文字：${question.id} 已落到 ${draft.id}，旧文字保留在疑问卡片中`
      );
    }

    const log: SyncLogEntry = {
      id: `log-${Date.now()}`,
      at: Date.now(),
      summary: `受理 ${seen.size} 条：合并 ${merged}、失败留队 ${failed}、重复回传 ${duplicates} 条只算一次`,
      details,
    };
    return { ...state, questions, outbox: survivors, syncLog: [log, ...state.syncLog] };
  })
);
