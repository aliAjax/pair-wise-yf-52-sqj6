import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Store } from '@ngrx/store';
import { TranslocoModule } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import {
  activateVersion,
  addVersion,
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
} from './state/script.actions';
import { Annotation, AnnotationTargetType, ScriptState, ScriptVersion } from './state/script.reducer';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, DragDropModule, MatToolbarModule, MatButtonModule, MatCardModule, MatTabsModule, MatChipsModule, MatIconModule, TranslocoModule],
  template: `
    <mat-toolbar color="primary" class="topbar">
      <span>{{ 'title' | transloco }}</span>
      <span class="spacer"></span>
      <button mat-stroked-button (click)="toggleOnline()">
        {{ ((state$ | async)?.online ? 'online' : 'offline') | transloco }}
      </button>
      <button mat-flat-button color="accent" (click)="toggleRehearsal()">
        {{ ((state$ | async)?.rehearsalMode ? 'normalMode' : 'rehearsalMode') | transloco }}
      </button>
    </mat-toolbar>

    <main [class.rehearsal]="(state$ | async)?.rehearsalMode">
      <section class="summary">
        <mat-card>
          <mat-card-title>版本控制</mat-card-title>
          <p>编剧提交后由舞台监督逐条采纳，未确认内容不会进入排练版本；已发布版本不再接收离线疑问，疑问自动转入下一版。</p>
          <div class="chips">
            <button mat-stroked-button *ngFor="let version of versions" [color]="version.id === activeVersionId ? 'primary' : ''" (click)="activate(version.id)">
              {{ version.label }} · {{ version.playwright }} · {{ version.published ? '已发布' : '草稿' }}
            </button>
            <button mat-flat-button color="primary" (click)="createDraft()">新增导演修订</button>
            <button mat-flat-button color="accent" *ngIf="activeVersion && !activeVersion.published" (click)="publish(activeVersion.id)">舞台监督发布本版</button>
          </div>
        </mat-card>
      </section>

      <section *ngIf="activeVersion" class="workspace">
        <mat-card class="script">
          <mat-card-title>{{ activeVersion.label }}</mat-card-title>
          <mat-card-subtitle>{{ activeVersion.note }}</mat-card-subtitle>
          <mat-tab-group>
            <mat-tab label="角色台词">
              <div cdkDropList (cdkDropListDropped)="dropLine($event)"><article class="line" cdkDrag *ngFor="let line of activeVersion.lines">
                <div class="line-body">
                  <div><b>{{ line.role }}</b></div>
                  <p *ngIf="editingLineId !== line.id">{{ line.text }}</p>
                  <textarea *ngIf="editingLineId === line.id" #lt class="edit-text" rows="2" [value]="line.text"></textarea>
                  <div class="line-meta">
                    <span class="status" [class.ok]="line.status === 'accepted'">{{ line.status }}</span>
                    <span class="q-count" *ngIf="questionCount(line.id)">疑问 {{ questionCount(line.id) }}</span>
                  </div>
                  <div class="q-form" *ngIf="asking?.type === 'line' && asking?.id === line.id">
                    <textarea #lq rows="2" placeholder="断网也能写：对这句台词的疑问……"></textarea>
                    <button mat-flat-button color="primary" (click)="submitQuestion('line', line.id, lq)">提交疑问</button>
                  </div>
                </div>
                <div class="line-actions">
                  <button mat-button color="primary" (click)="reviewLine(line.id, 'accepted')">采纳</button>
                  <button mat-button color="warn" (click)="reviewLine(line.id, 'returned')">退回</button>
                  <button mat-button (click)="toggleAsk('line', line.id)">标疑问</button>
                  <button mat-button *ngIf="!activeVersion.published" (click)="toggleEditLine(line, lt)">{{ editingLineId === line.id ? '保存修订' : '编辑正文' }}</button>
                  <button mat-button color="warn" *ngIf="!activeVersion.published" (click)="removeLine(line.id)">撤下</button>
                </div>
              </article></div>
            </mat-tab>
            <mat-tab label="舞台提示">
              <article class="line" *ngFor="let cue of activeVersion.cues">
                <div class="line-body">
                  <div><b>{{ cue.scene }}</b></div>
                  <p *ngIf="editingCueId !== cue.id">{{ cue.text }}</p>
                  <textarea *ngIf="editingCueId === cue.id" #ct class="edit-text" rows="2" [value]="cue.text"></textarea>
                  <div class="line-meta">
                    <span class="status" [class.ok]="cue.status === 'accepted'">{{ cue.status }}</span>
                    <span class="q-count" *ngIf="questionCount(cue.id)">疑问 {{ questionCount(cue.id) }}</span>
                  </div>
                  <div class="q-form" *ngIf="asking?.type === 'cue' && asking?.id === cue.id">
                    <textarea #cq rows="2" placeholder="断网也能写：对这条舞台提示的疑问……"></textarea>
                    <button mat-flat-button color="primary" (click)="submitQuestion('cue', cue.id, cq)">提交疑问</button>
                  </div>
                </div>
                <div class="line-actions">
                  <button mat-button color="primary" (click)="reviewCue(cue.id, 'accepted')">采纳</button>
                  <button mat-button color="warn" (click)="reviewCue(cue.id, 'returned')">退回</button>
                  <button mat-button (click)="toggleAsk('cue', cue.id)">标疑问</button>
                  <button mat-button *ngIf="!activeVersion.published" (click)="toggleEditCue(cue, ct)">{{ editingCueId === cue.id ? '保存修订' : '编辑正文' }}</button>
                  <button mat-button color="warn" *ngIf="!activeVersion.published" (click)="removeCue(cue.id)">撤下</button>
                </div>
              </article>
            </mat-tab>
          </mat-tab-group>
        </mat-card>

        <mat-card class="compare">
          <mat-card-title>版本对比</mat-card-title>
          <p class="version-name">基准 v12 → {{ activeVersion.label }}</p>
          <div class="diff"><b>新增</b><span>{{ activeVersion.lines.length }} 条台词 / {{ activeVersion.cues.length }} 条提示</span></div>
          <div class="diff"><b>待确认</b><span>{{ pendingCount(activeVersion) }} 项</span></div>
          <div class="diff warn"><b>规则</b><span>正文以编剧修订为准，演员疑问不改文字；旧文字留档备查</span></div>
        </mat-card>
      </section>

      <section class="questions-panel">
        <mat-card>
          <mat-card-title>演员疑问 · 回传合并</mat-card-title>
          <p class="hint">断网期间标记的疑问缓存在本地，恢复网络后按编剧最新正文合并：正文改动的疑问自动落到新文字、旧文字留档备查；被撤下的台词/舞台提示挂起列出；已发布版本不再接收离线改动，自动转入下一版；合并失败可重试，重复回传只算一次。</p>
          <div class="q-toolbar">
            <input #actorInput class="actor-input" [value]="actorName" (input)="actorName = actorInput.value" placeholder="演员姓名" />
            <button mat-flat-button color="primary" (click)="upload()" [disabled]="!queuedCount">回传合并{{ queuedCount ? ('（' + queuedCount + '）') : '' }}</button>
            <span class="offline-hint" *ngIf="!(state$ | async)?.online">离线中：疑问已写入本地缓存，恢复网络后自动合并</span>
          </div>

          <div class="batch" *ngFor="let batch of batches">
            <span class="batch-id">批次 {{ batch.id }}</span>
            <span class="batch-status" [class]="batch.status">{{ batchStatusLabel(batch.status) }}</span>
            <span class="batch-attempts">尝试 {{ batch.attempts }} 次</span>
            <button mat-button *ngIf="batch.status !== 'done'" (click)="retry(batch.id)">重试</button>
            <span class="batch-error" *ngIf="batch.lastError">{{ batch.lastError }}</span>
          </div>

          <div class="ann-block">
            <h3>排队中 · 等待回传 <span class="count">{{ queuedCount }}</span></h3>
            <div class="ann" *ngFor="let ann of queuedAnnotations">
              <div class="ann-head"><b>{{ ann.actor }}</b><span class="ann-target">{{ targetLabel(ann) }} · {{ versionName(ann.versionId) }}</span></div>
              <p class="ann-q">{{ ann.question }}</p>
            </div>
            <p class="empty" *ngIf="!queuedAnnotations.length">暂无排队中的疑问</p>
          </div>

          <div class="ann-block">
            <h3>已落位 · 正文未改动 <span class="count">{{ anchoredAnnotations.length }}</span></h3>
            <div class="ann ok" *ngFor="let ann of anchoredAnnotations">
              <div class="ann-head"><b>{{ ann.actor }}</b><span class="ann-target">{{ targetLabel(ann) }} · {{ versionName(ann.resolvedVersionId || ann.versionId) }}</span></div>
              <p class="ann-q">{{ ann.question }}</p>
              <p class="ann-text">{{ ann.currentText }}</p>
            </div>
            <p class="empty" *ngIf="!anchoredAnnotations.length">暂无已落位疑问</p>
          </div>

          <div class="ann-block">
            <h3>已迁移 · 旧文字留档备查 <span class="count">{{ migratedAnnotations.length }}</span></h3>
            <div class="ann migrated" *ngFor="let ann of migratedAnnotations">
              <div class="ann-head"><b>{{ ann.actor }}</b><span class="ann-target">{{ targetLabel(ann) }} · {{ versionName(ann.resolvedVersionId || ann.versionId) }}</span></div>
              <p class="ann-q">{{ ann.question }}</p>
              <p class="ann-text"><s class="old">{{ ann.textSnapshot }}</s></p>
              <p class="ann-text arrow">↓</p>
              <p class="ann-text new">{{ ann.currentText }}</p>
            </div>
            <p class="empty" *ngIf="!migratedAnnotations.length">暂无迁移疑问</p>
          </div>

          <div class="ann-block">
            <h3>已挂起 · 条目被撤下或转入下一版无对应 <span class="count">{{ suspendedAnnotations.length }}</span></h3>
            <div class="ann suspended" *ngFor="let ann of suspendedAnnotations">
              <div class="ann-head"><b>{{ ann.actor }}</b><span class="ann-target">{{ targetLabel(ann) }} · 原 {{ versionName(ann.versionId) }}</span></div>
              <p class="ann-q">{{ ann.question }}</p>
              <p class="ann-text suspended-note">原条目已被编剧撤下，或已发布版本的疑问转入下一版后未找到对应条目，疑问挂起待处理。</p>
            </div>
            <p class="empty" *ngIf="!suspendedAnnotations.length">暂无挂起疑问</p>
          </div>
        </mat-card>
      </section>

      <aside class="offline" *ngIf="!(state$ | async)?.online">网络不可用，当前修改已写入本地缓存；恢复网络后疑问自动回传合并。</aside>
    </main>
  `,
  styles: [`
    .topbar { position: sticky; top: 0; z-index: 4; }
    .spacer { flex: 1; }
    main { max-width: 1180px; margin: 24px auto; padding: 0 18px 48px; }
    main.rehearsal { max-width: 860px; background: #111827; color: #f9fafb; margin-top: 0; }
    main.rehearsal .script, main.rehearsal .compare, main.rehearsal .summary { opacity: .92; }
    .summary { margin-bottom: 18px; }
    .chips { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; align-items: center; }
    .workspace { display: grid; grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); gap: 18px; }
    .line { cursor: grab; display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding: 16px 0; border-bottom: 1px solid #e5e7eb; }
    .line-body { flex: 1; min-width: 0; }
    .line p { margin: 8px 0; font-size: 17px; line-height: 1.6; }
    .line-meta { display: flex; gap: 10px; align-items: center; }
    .line-actions { display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }
    .edit-text { width: 100%; font: inherit; font-size: 16px; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; }
    .q-form { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; max-width: 420px; }
    .q-form textarea { font: inherit; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; }
    .q-count { font-size: 12px; color: #1d4ed8; background: #dbeafe; padding: 1px 8px; border-radius: 10px; }
    .status { font-size: 12px; color: #b45309; }
    .status.ok { color: #15803d; }
    .version-name { padding: 12px; background: #f3f4f6; border-radius: 8px; }
    .diff { display: flex; justify-content: space-between; border-bottom: 1px solid #e5e7eb; padding: 14px 0; }
    .diff.warn b { color: #b45309; }
    .questions-panel { margin-top: 18px; }
    .questions-panel .hint { color: #4b5563; font-size: 14px; line-height: 1.7; }
    .q-toolbar { display: flex; gap: 12px; align-items: center; margin: 12px 0; flex-wrap: wrap; }
    .actor-input { font: inherit; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; }
    .offline-hint { color: #b45309; font-size: 13px; }
    .batch { display: flex; gap: 10px; align-items: center; padding: 8px 12px; background: #f9fafb; border-radius: 8px; margin-bottom: 8px; flex-wrap: wrap; }
    .batch-id { font-weight: 600; font-size: 13px; }
    .batch-status { font-size: 12px; padding: 1px 8px; border-radius: 10px; background: #e5e7eb; }
    .batch-status.done { background: #dcfce7; color: #15803d; }
    .batch-status.failed { background: #fee2e2; color: #b91c1c; }
    .batch-status.queued, .batch-status.merging { background: #fef3c7; color: #b45309; }
    .batch-attempts { font-size: 12px; color: #6b7280; }
    .batch-error { font-size: 12px; color: #b91c1c; width: 100%; }
    .ann-block { margin-top: 16px; }
    .ann-block h3 { font-size: 15px; margin: 0 0 8px; }
    .ann-block .count { color: #6b7280; font-weight: normal; font-size: 13px; }
    .ann { border: 1px solid #e5e7eb; border-left: 4px solid #9ca3af; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; background: #fff; }
    .ann.ok { border-left-color: #15803d; }
    .ann.migrated { border-left-color: #b45309; }
    .ann.suspended { border-left-color: #b91c1c; background: #fef2f2; }
    .ann-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
    .ann-target { font-size: 12px; color: #6b7280; }
    .ann-q { margin: 6px 0; font-size: 15px; }
    .ann-text { margin: 4px 0; font-size: 14px; color: #374151; }
    .ann-text .old { color: #6b7280; }
    .ann-text .new { color: #15803d; font-weight: 600; }
    .ann-text.arrow { margin: 0; color: #b45309; }
    .suspended-note { color: #b91c1c; font-size: 13px; }
    .empty { color: #9ca3af; font-size: 13px; }
    .offline { position: fixed; right: 18px; bottom: 18px; padding: 14px 18px; color: #fff; background: #b45309; border-radius: 10px; box-shadow: 0 8px 30px #0003; }
    @media (max-width: 820px) { .workspace { grid-template-columns: 1fr; } .line { align-items: flex-start; } }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  readonly state$ = this.store.select('script');
  readonly activeVersion$ = this.store.select((state) => {
    const script = state.script as ScriptState;
    return script.versions.find((item) => item.id === script.activeVersionId) ?? script.versions[0];
  });
  private subscription?: Subscription;
  private onlineHandler = () => {
    this.store.dispatch(setOnline({ online: navigator.onLine }));
    if (navigator.onLine) this.store.dispatch(uploadAnnotations());
  };
  private offlineHandler = () => this.store.dispatch(setOnline({ online: false }));

  versions: ScriptVersion[] = [];
  activeVersion: ScriptVersion | undefined;
  activeVersionId = 'v12';
  annotations: Annotation[] = [];
  batches: ScriptState['batches'] = [];
  actorName = '演员甲';
  asking: { type: AnnotationTargetType; id: string } | null = null;
  editingLineId: string | null = null;
  editingCueId: string | null = null;

  constructor(private readonly store: Store<{ script: ScriptState }>) {}

  ngOnInit() {
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.offlineHandler);
    this.subscription = this.state$.subscribe((state) => {
      this.versions = state.versions;
      this.activeVersionId = state.activeVersionId;
      this.activeVersion = state.versions.find((item) => item.id === state.activeVersionId) ?? state.versions[0];
      this.annotations = state.annotations;
      this.batches = state.batches;
      localStorage.setItem('yf52-script-state-v2', JSON.stringify(state));
    });
    if (navigator.onLine) this.store.dispatch(uploadAnnotations());
  }

  ngOnDestroy() {
    window.removeEventListener('online', this.onlineHandler);
    window.removeEventListener('offline', this.offlineHandler);
    this.subscription?.unsubscribe();
  }

  get queuedAnnotations() { return this.annotations.filter((a) => a.status === 'queued'); }
  get anchoredAnnotations() { return this.annotations.filter((a) => a.status === 'anchored'); }
  get migratedAnnotations() { return this.annotations.filter((a) => a.status === 'migrated'); }
  get suspendedAnnotations() { return this.annotations.filter((a) => a.status === 'suspended'); }
  get queuedCount() { return this.queuedAnnotations.length; }

  versionName(id: string) { return this.versions.find((v) => v.id === id)?.label ?? id; }
  targetLabel(ann: Annotation) { return ann.targetType === 'line' ? '台词' : '舞台提示'; }
  batchStatusLabel(status: string) {
    return ({ queued: '排队中', merging: '合并中', done: '已完成', failed: '失败待重试' } as Record<string, string>)[status] ?? status;
  }
  questionCount(targetId: string) {
    return this.annotations.filter((a) => a.targetId === targetId && a.status !== 'suspended').length;
  }

  activate(id: string) { this.store.dispatch(activateVersion({ id })); }
  toggleRehearsal() { this.store.dispatch(toggleRehearsal()); }
  setOnline(online: boolean) { this.store.dispatch(setOnline({ online })); }
  toggleOnline() { this.state$.subscribe((state) => this.setOnline(!state.online)).unsubscribe(); }
  reviewLine(id: string, decision: 'accepted' | 'returned') { this.store.dispatch(reviewLine({ id, decision })); }
  dropLine(event: CdkDragDrop<unknown>) { if (event.previousIndex !== event.currentIndex) this.store.dispatch(reorderLines({ from: event.previousIndex, to: event.currentIndex })); }
  reviewCue(id: string, decision: 'accepted' | 'returned') { this.store.dispatch(reviewCue({ id, decision })); }
  pendingCount(version: ScriptVersion) { return version.lines.filter((item) => item.status === 'pending').length + version.cues.filter((item) => item.status === 'pending').length; }

  toggleAsk(type: AnnotationTargetType, id: string) {
    this.asking = this.asking?.type === type && this.asking?.id === id ? null : { type, id };
  }
  submitQuestion(targetType: AnnotationTargetType, targetId: string, input: HTMLTextAreaElement) {
    const question = input.value.trim();
    if (!question) return;
    this.store.dispatch(markQuestion({ versionId: this.activeVersionId, targetType, targetId, actor: this.actorName, question }));
    this.asking = null;
  }

  toggleEditLine(line: { id: string; text: string }, input?: HTMLTextAreaElement) {
    if (this.editingLineId === line.id && input) {
      this.store.dispatch(updateLineText({ lineId: line.id, text: input.value }));
      this.editingLineId = null;
    } else {
      this.editingLineId = line.id;
    }
  }
  toggleEditCue(cue: { id: string; text: string }, input?: HTMLTextAreaElement) {
    if (this.editingCueId === cue.id && input) {
      this.store.dispatch(updateCueText({ cueId: cue.id, text: input.value }));
      this.editingCueId = null;
    } else {
      this.editingCueId = cue.id;
    }
  }
  removeLine(id: string) {
    if (window.confirm('确认撤下这条台词？演员对它的疑问将在下次回传时挂起。')) this.store.dispatch(removeLine({ lineId: id }));
  }
  removeCue(id: string) {
    if (window.confirm('确认撤下这条舞台提示？演员对它的疑问将在下次回传时挂起。')) this.store.dispatch(removeCue({ cueId: id }));
  }

  publish(id: string) { this.store.dispatch(publishVersion({ id })); }
  upload() { this.store.dispatch(uploadAnnotations()); }
  retry(id: string) { this.store.dispatch(retryBatch({ id })); }

  createDraft() {
    const id = `v${Date.now().toString().slice(-4)}`;
    const version: ScriptVersion = {
      id,
      label: `导演修订 ${id}`,
      playwright: '本地草稿',
      note: '断网期间创建的修订，等待与编剧版本合并。',
      published: false,
      lines: [{ id: `${id}-l1`, role: '周岚', text: '这次换你告诉我，灯亮之后准备去哪里。', status: 'pending' }],
      cues: [{ id: `${id}-c1`, scene: '第三场', text: '追光保持到台词结束，再执行全场收光', status: 'pending' }]
    };
    this.store.dispatch(addVersion({ version }));
    this.store.dispatch(activateVersion({ id }));
  }
}
