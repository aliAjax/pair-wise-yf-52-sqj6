import { createAction, props } from '@ngrx/store';
import { CueDecision, ScriptVersion } from './script.reducer';

export const addVersion = createAction('[Script] Add Version', props<{ version: ScriptVersion }>());
export const activateVersion = createAction('[Script] Activate Version', props<{ id: string }>());
export const reviewLine = createAction('[Script] Review Line', props<{ id: string; decision: 'accepted' | 'returned' }>());
export const reorderLines = createAction('[Script] Reorder Lines', props<{ from: number; to: number }>());
export const reviewCue = createAction('[Script] Review Cue', props<{ id: string; decision: CueDecision }>());
export const toggleRehearsal = createAction('[Script] Toggle Rehearsal');
export const setOnline = createAction('[Script] Set Online', props<{ online: boolean }>());

/** 舞台监督发布版本：发布后冻结，离线改动不再收入，只能进下一版 */
export const publishVersion = createAction('[Script] Publish Version', props<{ id: string }>());

/** 演员标记疑问（正文不可编辑，只能挂疑问）。离线时进 outbox 等待回传 */
export const addQuestion = createAction(
  '[Script] Add Question',
  props<{ id: string; target: 'line' | 'cue'; targetId: string; versionId: string; note: string; actor: string }>()
);

/** 编剧在网络恢复后提交新修订（模拟） */
export const submitPlaywrightDraft = createAction('[Script] Submit Playwright Draft', props<{ version: ScriptVersion }>());

/** 回传并合并 outbox 中尚未合完的那批疑问；已合并的重复回传按幂等键去重，只算一次 */
export const syncQuestions = createAction('[Script] Sync Questions', props<{ failHalf?: boolean }>());

/** 模拟演员重复回传同一条疑问 */
export const resendQuestion = createAction('[Script] Resend Question', props<{ questionId: string }>());

/** 切换「模拟首批合并失败」开关，用于演示接着重试剩余批次 */
export const toggleSimulateFailure = createAction('[Script] Toggle Simulate Failure');

/** 重置为「断网最后一周」初始场景，便于反复演示 */
export const resetScenario = createAction('[Script] Reset Scenario');
