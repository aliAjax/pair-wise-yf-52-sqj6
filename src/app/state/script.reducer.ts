import { createReducer, on } from '@ngrx/store';
import {
  addVersion,
  activateVersion,
  markQuestion,
  publishVersion,
  removeCue,
  removeLine,
  reorderLines,
  retryBatch,
  reviewCue,
  reviewLine,
  setOnline,
  toggleRehearsal,
  updateCueText,
  updateLineText,
  uploadAnnotations
} from './script.actions';

export type CueDecision = 'pending' | 'accepted' | 'returned';

export interface ScriptVersion {
  id: string;
  label: string;
  playwright: string;
  note: string;
  published: boolean;
  lines: Array<{ id: string; role: string; text: string; status: 'pending' | 'accepted' | 'returned' }>;
  cues: Array<{ id: string; scene: string; text: string; status: CueDecision }>;
}

export type AnnotationTargetType = 'line' | 'cue';
export type AnnotationStatus = 'queued' | 'anchored' | 'migrated' | 'suspended';

export interface Annotation {
  id: string;
  batchId: string;
  targetType: AnnotationTargetType;
  targetId: string;
  versionId: string;
  actor: string;
  question: string;
  textSnapshot: string; // 标记时的旧文字，迁移后留作备查
  status: AnnotationStatus;
  resolvedVersionId?: string; // 合并后实际落点版本
  currentText?: string; // 合并后落点的新文字
  createdAt: number;
  resolvedAt?: number;
}

export type BatchStatus = 'queued' | 'merging' | 'done' | 'failed';

export interface MergeBatch {
  id: string;
  status: BatchStatus;
  annotationIds: string[];
  attempts: number;
  lastError?: string;
  createdAt: number;
}

export interface ScriptState {
  versions: ScriptVersion[];
  activeVersionId: string;
  rehearsalMode: boolean;
  online: boolean;
  annotations: Annotation[];
  batches: MergeBatch[];
}

const initialVersions: ScriptVersion[] = [
  {
    id: 'v12', label: '排练稿 v12', playwright: '林编剧', note: '重写第三场父女冲突，舞台灯光提示延后2拍。', published: true,
    lines: [
      { id: 'l1', role: '周岚', text: '你每次都说等明天，可舞台不会等我们。', status: 'pending' },
      { id: 'l2', role: '周野', text: '那就让灯灭吧，我早已背熟黑暗。', status: 'pending' }
    ],
    cues: [
      { id: 'c1', scene: '第三场', text: '侧灯收至30%，雨声渐入', status: 'pending' },
      { id: 'c2', scene: '第三场', text: '周野坐到舞台左前区，保留两拍静默', status: 'accepted' }
    ]
  },
  {
    id: 'v13', label: '导演修订 v13', playwright: '林编剧', note: '调整周岚结论，加入一次性追光变化。', published: false,
    lines: [
      { id: 'l1', role: '周岚', text: '你总说明天，但今晚我们必须把话说完。', status: 'pending' },
      { id: 'l3', role: '周岚', text: '看着灯，再说一次你为什么回来。', status: 'pending' }
    ],
    cues: [{ id: 'c3', scene: '第三场', text: '追光由冷白切换至琥珀，等待雨声下落', status: 'pending' }]
  }
];

const STORAGE_KEY = 'yf52-script-state-v2';

function getInitialState(): ScriptState {
  const fallback: ScriptState = {
    versions: initialVersions,
    activeVersionId: 'v12',
    rehearsalMode: false,
    online: true,
    annotations: [],
    batches: []
  };
  if (typeof localStorage === 'undefined') return fallback;
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return fallback;
  try {
    const parsed = JSON.parse(saved) as Partial<ScriptState>;
    return {
      versions: Array.isArray(parsed.versions) && parsed.versions.length ? parsed.versions : initialVersions,
      activeVersionId: parsed.activeVersionId ?? 'v12',
      rehearsalMode: parsed.rehearsalMode ?? false,
      online: parsed.online ?? true,
      annotations: Array.isArray(parsed.annotations) ? parsed.annotations : [],
      batches: Array.isArray(parsed.batches) ? parsed.batches : []
    };
  } catch {
    return fallback;
  }
}

function nextVersionId(versions: ScriptVersion[]): string {
  const ids = versions.map((v) => v.id);
  let n = versions.length + 1;
  while (ids.includes(`v${n}`)) n += 1;
  return `v${n}`;
}

// 离线疑问合并：以编剧正文为准，解析单条疑问的落点。
// - 正文未改动：anchored（落位）
// - 正文已改动：migrated（疑问落到新文字，旧文字留档备查）
// - 条目被撤下或落点不存在：suspended（挂起列出）
// - 目标版本已发布：转入其后第一个未发布版本；没有则自动生成下一版草稿
function resolveAnnotation(
  annotation: Annotation,
  versions: ScriptVersion[]
): { annotation: Annotation; versions: ScriptVersion[] } {
  let working = versions;
  const target = working.find((v) => v.id === annotation.versionId);
  if (!target) {
    return {
      annotation: { ...annotation, status: 'suspended', resolvedVersionId: annotation.versionId, currentText: '', resolvedAt: Date.now() },
      versions: working
    };
  }
  let resolvedVersionId = annotation.versionId;
  let targetVersion = target;
  if (target.published) {
    const idx = working.indexOf(target);
    let next = working.slice(idx + 1).find((v) => !v.published);
    if (!next) {
      next = {
        id: nextVersionId(working),
        label: '下一版 · 疑问归集',
        playwright: '系统生成',
        note: '已发布版本不再接收离线演员疑问，自动转入下一版归集。',
        published: false,
        lines: [],
        cues: []
      };
      working = [...working, next];
    }
    resolvedVersionId = next.id;
    targetVersion = next;
  }
  const item =
    annotation.targetType === 'line'
      ? targetVersion.lines.find((l) => l.id === annotation.targetId)
      : targetVersion.cues.find((c) => c.id === annotation.targetId);
  if (!item) {
    return {
      annotation: { ...annotation, status: 'suspended', resolvedVersionId, currentText: '', resolvedAt: Date.now() },
      versions: working
    };
  }
  if (item.text === annotation.textSnapshot) {
    return {
      annotation: { ...annotation, status: 'anchored', resolvedVersionId, currentText: item.text, resolvedAt: Date.now() },
      versions: working
    };
  }
  return {
    annotation: { ...annotation, status: 'migrated', resolvedVersionId, currentText: item.text, resolvedAt: Date.now() },
    versions: working
  };
}

// 合并一批疑问；已落位/迁移/挂起的疑问不再重复处理（幂等）
function mergeBatch(
  state: ScriptState,
  batch: MergeBatch,
  pending: Annotation[],
  attempts: number
): ScriptState {
  if (!pending.length) return state;
  const upsert = (next: MergeBatch): MergeBatch[] => [...state.batches.filter((b) => b.id !== next.id), next];
  if (!state.online) {
    return {
      ...state,
      annotations: state.annotations.map((a) => (pending.includes(a) ? { ...a, batchId: batch.id } : a)),
      batches: upsert({ ...batch, status: 'failed', attempts, lastError: '离线状态下无法合并：恢复网络后重试，疑问不会丢失。' })
    };
  }
  let versions = state.versions;
  const annotations = state.annotations.map((a) => {
    if (!pending.includes(a)) return a;
    const resolved = resolveAnnotation({ ...a, batchId: batch.id }, versions);
    versions = resolved.versions;
    return resolved.annotation;
  });
  return {
    ...state,
    versions,
    annotations,
    batches: upsert({ ...batch, status: 'done', attempts, lastError: undefined })
  };
}

export const scriptReducer = createReducer(
  getInitialState(),
  on(addVersion, (state, { version }) => ({ ...state, versions: [...state.versions, version] })),
  on(activateVersion, (state, { id }) => ({ ...state, activeVersionId: id })),
  on(reviewLine, (state, { id, decision }) => ({
    ...state,
    versions: state.versions.map((version) => version.id !== state.activeVersionId ? version : ({
      ...version,
      lines: version.lines.map((line) => line.id === id ? { ...line, status: decision } : line)
    }))
  })),
  on(reorderLines, (state, { from, to }) => ({
    ...state,
    versions: state.versions.map((version) => {
      if (version.id !== state.activeVersionId || from === to) return version;
      const lines = [...version.lines];
      const [moved] = lines.splice(from, 1);
      lines.splice(to, 0, moved);
      return { ...version, lines };
    })
  })),
  on(reviewCue, (state, { id, decision }) => ({
    ...state,
    versions: state.versions.map((version) => version.id !== state.activeVersionId ? version : ({
      ...version,
      cues: version.cues.map((cue) => cue.id === id ? { ...cue, status: decision } : cue)
    }))
  })),
  on(toggleRehearsal, (state) => ({ ...state, rehearsalMode: !state.rehearsalMode })),
  on(setOnline, (state, { online }) => ({ ...state, online })),
  on(markQuestion, (state, { versionId, targetType, targetId, actor, question }) => {
    const version = state.versions.find((v) => v.id === versionId);
    const item =
      version && (targetType === 'line' ? version.lines.find((l) => l.id === targetId) : version.cues.find((c) => c.id === targetId));
    if (!version || !item) return state;
    const trimmed = question.trim();
    if (!trimmed) return state;
    const annotation: Annotation = {
      id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      batchId: '',
      targetType,
      targetId,
      versionId,
      actor: actor.trim() || '演员甲',
      question: trimmed,
      textSnapshot: item.text,
      status: 'queued',
      createdAt: Date.now()
    };
    return { ...state, annotations: [...state.annotations, annotation] };
  }),
  on(uploadAnnotations, (state) => {
    const queued = state.annotations.filter((a) => a.status === 'queued');
    if (!queued.length) return state;
    // 同一批疑问重复回传只算一次：复用尚未完成的同批批次
    const existing = state.batches.find(
      (b) => b.status !== 'done' && b.annotationIds.length === queued.length && b.annotationIds.every((id) => queued.some((q) => q.id === id))
    );
    const batchId = existing?.id ?? `b${Date.now().toString(36)}`;
    const batch: MergeBatch = existing ?? {
      id: batchId,
      status: 'queued',
      annotationIds: queued.map((a) => a.id),
      attempts: 0,
      createdAt: Date.now()
    };
    return mergeBatch(state, batch, queued, batch.attempts + 1);
  }),
  on(retryBatch, (state, { id }) => {
    const batch = state.batches.find((b) => b.id === id);
    if (!batch || batch.status === 'done') return state;
    const pending = state.annotations.filter((a) => a.batchId === id && a.status === 'queued');
    if (!pending.length) {
      return { ...state, batches: state.batches.map((b) => (b.id === id ? { ...b, status: 'done' as const, lastError: undefined } : b)) };
    }
    return mergeBatch(state, batch, pending, batch.attempts + 1);
  }),
  on(publishVersion, (state, { id }) => ({
    ...state,
    versions: state.versions.map((v) => (v.id === id ? { ...v, published: true } : v))
  })),
  on(updateLineText, (state, { lineId, text }) => {
    const trimmed = text.trim();
    if (!trimmed) return state;
    return {
      ...state,
      versions: state.versions.map((v) =>
        v.id !== state.activeVersionId || v.published
          ? v
          : { ...v, lines: v.lines.map((l) => (l.id === lineId ? { ...l, text: trimmed } : l)) }
      )
    };
  }),
  on(updateCueText, (state, { cueId, text }) => {
    const trimmed = text.trim();
    if (!trimmed) return state;
    return {
      ...state,
      versions: state.versions.map((v) =>
        v.id !== state.activeVersionId || v.published
          ? v
          : { ...v, cues: v.cues.map((c) => (c.id === cueId ? { ...c, text: trimmed } : c)) }
      )
    };
  }),
  on(removeLine, (state, { lineId }) => ({
    ...state,
    versions: state.versions.map((v) =>
      v.id !== state.activeVersionId || v.published ? v : { ...v, lines: v.lines.filter((l) => l.id !== lineId) }
    )
  })),
  on(removeCue, (state, { cueId }) => ({
    ...state,
    versions: state.versions.map((v) =>
      v.id !== state.activeVersionId || v.published ? v : { ...v, cues: v.cues.filter((c) => c.id !== cueId) }
    )
  }))
);
