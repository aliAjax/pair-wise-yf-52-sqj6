import { createAction, props } from '@ngrx/store';
import { AnnotationTargetType, CueDecision, ScriptVersion } from './script.reducer';

export const addVersion = createAction('[Script] Add Version', props<{ version: ScriptVersion }>());
export const activateVersion = createAction('[Script] Activate Version', props<{ id: string }>());
export const reviewLine = createAction('[Script] Review Line', props<{ id: string; decision: 'accepted' | 'returned' }>());
export const reorderLines = createAction('[Script] Reorder Lines', props<{ from: number; to: number }>());
export const reviewCue = createAction('[Script] Review Cue', props<{ id: string; decision: CueDecision }>());
export const toggleRehearsal = createAction('[Script] Toggle Rehearsal');
export const setOnline = createAction('[Script] Set Online', props<{ online: boolean }>());

// 演员在断网期间标记疑问，进入本地队列等待回传合并
export const markQuestion = createAction(
  '[Script] Mark Question',
  props<{ versionId: string; targetType: AnnotationTargetType; targetId: string; actor: string; question: string }>()
);
// 恢复网络后回传合并离线疑问（重复回传只算一次）
export const uploadAnnotations = createAction('[Script] Upload Annotations');
// 合并失败后重试没合完的那一批
export const retryBatch = createAction('[Script] Retry Batch', props<{ id: string }>());
// 舞台监督发布版本：发布后的版本不再接收离线改动
export const publishVersion = createAction('[Script] Publish Version', props<{ id: string }>());
// 编剧在草稿版本上修订台词/舞台提示正文
export const updateLineText = createAction('[Script] Update Line Text', props<{ lineId: string; text: string }>());
export const updateCueText = createAction('[Script] Update Cue Text', props<{ cueId: string; text: string }>());
// 编剧撤下台词/舞台提示
export const removeLine = createAction('[Script] Remove Line', props<{ lineId: string }>());
export const removeCue = createAction('[Script] Remove Cue', props<{ cueId: string }>());
