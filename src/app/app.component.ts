import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
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
  addQuestion,
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
} from './state/script.actions';
import { playwrightDraftV14, Question, ScriptState, ScriptVersion } from './state/script.reducer';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, DragDropModule, MatToolbarModule, MatButtonModule, MatCardModule, MatTabsModule, MatChipsModule, MatIconModule, TranslocoModule],
  template: `
    <mat-toolbar color="primary" class="topbar">
      <span>{{ 'title' | transloco }}</span>
      <span class="spacer"></span>
      <button mat-stroked-button (click)="toggleOnline()">
        {{ (state$ | async)?.online ? '在线' : '离线缓存中' }}
      </button>
      <button mat-flat-button color="accent" (click)="toggleRehearsal()">
        {{ (state$ | async)?.rehearsalMode ? '退出排练模式' : '排练提词模式' }}
      </button>
      <button mat-stroked-button (click)="reset()">重置场景</button>
    </mat-toolbar>

    <main [class.rehearsal]="(state$ | async)?.rehearsalMode">
      <!-- 业务规则说明 -->
      <section class="rules">
        <mat-card>
          <mat-card-title>排练最后一周 · 离线疑问回传规则</mat-card-title>
          <ol>
            <li>演员离线背词，只能对台词/舞台提示<b>标疑问</b>，不改正文。</li>
            <li>舞台监督<b>已发布的版本冻结</b>（v12），离线改动一律不收，只进下一版。</li>
            <li>回网后编剧先提交修订；疑问合并时：文字被改写则<b>转挂到新文字、旧文字留底</b>；台词/提示被撤下则疑问<b>挂起列出</b>。</li>
            <li>首批合并可能失败，点「重试剩余批次」只处理没合完的；<b>重复回传幂等，只算一次</b>。</li>
          </ol>
        </mat-card>
      </section>

      <section class="summary">
        <mat-card>
          <mat-card-title>版本控制</mat-card-title>
          <div class="chips">
            <button mat-stroked-button *ngFor="let version of (state$ | async)?.versions"
                    [color]="version.id === (state$ | async)?.activeVersionId ? 'primary' : ''"
                    (click)="activate(version.id)">
              {{ version.label }}
              <mat-icon *ngIf="version.published" fontIcon="lock" class="lock-icon"></mat-icon>
            </button>
          </div>
          <p class="hint">
            <mat-icon fontIcon="lock"></mat-icon>
            带锁为舞台监督已发布版本：正文只读，演员疑问与采纳操作都只进下一版。
          </p>
          <div class="chips">
            <button mat-flat-button color="primary"
                    [disabled]="hasV14()"
                    (click)="submitDraft()">编剧提交 v14 修订（回网后）</button>
            <button mat-stroked-button (click)="toggleSimulateFailure()">
              模拟首批半批失败：{{ ((state$ | async)?.simulateFailure ? '开' : '关') }}
            </button>
          </div>
        </mat-card>
      </section>

      <section *ngIf="activeVersion$ | async as activeVersion" class="workspace">
        <mat-card class="script">
          <mat-card-title>
            {{ activeVersion.label }}
            <span class="freeze-tag" *ngIf="activeVersion.published">已发布 · 冻结</span>
          </mat-card-title>
          <mat-card-subtitle>{{ activeVersion.note }}</mat-card-subtitle>
          <mat-tab-group>
            <mat-tab label="角色台词">
              <div cdkDropList [cdkDropListDisabled]="activeVersion.published" (cdkDropListDropped)="dropLine($event)">
                <article class="line" cdkDrag [class.locked]="activeVersion.published" *ngFor="let line of activeVersion.lines">
                  <div class="line-body">
                    <b>{{ line.role }}</b>
                    <p>{{ line.text }}</p>
                    <span class="status" [class.ok]="line.status === 'accepted'">{{ line.status }}</span>
                    <span class="qcount" *ngIf="questionsOn('line', line.id).length">
                      · 疑问 {{ questionsOn('line', line.id).length }} 条
                    </span>
                    <div class="flag-row">
                      <input #lineQuestion type="text" placeholder="演员标疑问（不改词）…" [disabled]="false"/>
                      <button mat-button color="accent" (click)="flag('line', line.id, activeVersion.id, lineQuestion.value); lineQuestion.value=''">
                        <mat-icon fontIcon="help_outline"></mat-icon> 标疑问
                      </button>
                    </div>
                  </div>
                  <div class="line-actions">
                    <button mat-button color="primary" [disabled]="activeVersion.published" (click)="reviewLine(line.id, 'accepted')">采纳</button>
                    <button mat-button color="warn" [disabled]="activeVersion.published" (click)="reviewLine(line.id, 'returned')">退回</button>
                  </div>
                </article>
              </div>
              <p class="hint" *ngIf="activeVersion.published">该版本已发布，采纳/退回/拖拽排序均已锁定，任何改动只进下一版。</p>
            </mat-tab>
            <mat-tab label="舞台提示">
              <article class="line" *ngFor="let cue of activeVersion.cues">
                <div class="line-body">
                  <b>{{ cue.scene }}</b>
                  <p>{{ cue.text }}</p>
                  <span class="status" [class.ok]="cue.status === 'accepted'">{{ cue.status }}</span>
                  <span class="qcount" *ngIf="questionsOn('cue', cue.id).length">
                    · 疑问 {{ questionsOn('cue', cue.id).length }} 条
                  </span>
                  <div class="flag-row">
                    <input #cueQuestion type="text" placeholder="演员/场记标疑问…"/>
                    <button mat-button color="accent" (click)="flag('cue', cue.id, activeVersion.id, cueQuestion.value); cueQuestion.value=''">
                      <mat-icon fontIcon="help_outline"></mat-icon> 标疑问
                    </button>
                  </div>
                </div>
                <div class="line-actions">
                  <button mat-button color="primary" [disabled]="activeVersion.published" (click)="reviewCue(cue.id, 'accepted')">采纳</button>
                  <button mat-button color="warn" [disabled]="activeVersion.published" (click)="reviewCue(cue.id, 'returned')">退回</button>
                </div>
              </article>
            </mat-tab>
          </mat-tab-group>
        </mat-card>

        <div class="side">
          <!-- 离线回传队列 -->
          <mat-card class="outbox-card">
            <mat-card-title>离线疑问回传队列（{{ (state$ | async)?.outbox.length ?? 0 }}）</mat-card-title>
            <p class="hint" *ngIf="(state$ | async)?.online === false">当前离线：标记先存本地队列，回网后再合并。</p>
            <ul class="outbox" *ngIf="(state$ | async)?.outbox.length">
              <li *ngFor="let entry of (state$ | async)?.outbox">
                <b>{{ entry.questionId }}</b>
                <span>尝试 {{ entry.attempts }} 次</span>
                <span class="err" *ngIf="entry.lastError">{{ entry.lastError }}</span>
                <button mat-button color="accent" (click)="resend(entry.questionId)">重复回传一次</button>
              </li>
            </ul>
            <p class="hint" *ngIf="!(state$ | async)?.outbox.length">队列已清空，没有待合并的离线改动。</p>
            <div class="chips">
              <button mat-flat-button color="primary" [disabled]="(state$ | async)?.online === false || !((state$ | async)?.outbox.length)"
                      (click)="sync()">回网合并本批</button>
              <button mat-stroked-button [disabled]="(state$ | async)?.online === false || !((state$ | async)?.outbox.length)"
                      (click)="sync(false)">重试剩余批次（不再模拟失败）</button>
            </div>
          </mat-card>

          <!-- 已合并：转挂新文字 -->
          <mat-card class="questions-card">
            <mat-card-title>演员疑问 · 已转挂新文字（{{ rebasedQuestions().length }}）</mat-card-title>
            <article class="question rebased" *ngFor="let q of rebasedQuestions()">
              <header><b>{{ q.actor }}</b><span class="chip chip-rebased">已落到 {{ q.anchoredVersionId }}</span></header>
              <p class="note">{{ q.note }}</p>
              <p class="new-text"><mat-icon fontIcon="edit_note"></mat-icon> 新文字：{{ currentText(q) || '（未找到）' }}</p>
              <details>
                <summary>旧文字备查（标记于 {{ q.versionId }}）</summary>
                <p class="old-text">
                  <ng-container *ngIf="q.target === 'line'">{{ q.snapshotRole }}：</ng-container>
                  <ng-container *ngIf="q.target === 'cue'">{{ q.snapshotScene }} · 舞台提示：</ng-container>
                  {{ q.snapshotText }}
                </p>
              </details>
            </article>
            <p class="hint" *ngIf="!rebasedQuestions().length">尚无成功转挂的疑问。</p>
          </mat-card>

          <!-- 挂起：被撤下 -->
          <mat-card class="questions-card warn-card">
            <mat-card-title>挂起疑问 · 台词/提示被编剧撤下（{{ suspendedQuestions().length }}）</mat-card-title>
            <article class="question suspended" *ngFor="let q of suspendedQuestions()">
              <header><b>{{ q.actor }}</b><span class="chip chip-suspended">挂起</span></header>
              <p class="note">{{ q.note }}</p>
              <p class="old-text">被撤下的旧文字（{{ q.versionId }}）：
                <ng-container *ngIf="q.target === 'line'">{{ q.snapshotRole }}：</ng-container>
                <ng-container *ngIf="q.target === 'cue'">{{ q.snapshotScene }}：</ng-container>
                {{ q.snapshotText }}
              </p>
              <p class="hint">疑问不进入正文，列出待舞台监督与编剧确认去向。</p>
            </article>
            <p class="hint" *ngIf="!suspendedQuestions().length">尚无挂起疑问。</p>
          </mat-card>

          <!-- 待处理/失败 -->
          <mat-card class="questions-card" *ngIf="pendingQuestions().length">
            <mat-card-title>待回传 / 失败留队（{{ pendingQuestions().length }}）</mat-card-title>
            <article class="question" *ngFor="let q of pendingQuestions()">
              <header>
                <b>{{ q.actor }}</b>
                <span class="chip" [class.chip-failed]="q.status === 'failed'" [class.chip-pending]="q.status === 'pending'">
                  {{ q.status === 'failed' ? '合并失败，待重试' : '待回传' }}
                </span>
              </header>
              <p class="note">{{ q.note }}</p>
              <p class="old-text">标记文字：{{ q.snapshotText }}</p>
            </article>
          </mat-card>
        </div>
      </section>

      <!-- 合并日志 -->
      <section class="logs" *ngIf="(state$ | async)?.syncLog.length">
        <mat-card>
          <mat-card-title>回传合并日志</mat-card-title>
          <article class="log" *ngFor="let log of (state$ | async)?.syncLog">
            <header><b>{{ log.summary }}</b><span>{{ log.at | date: 'HH:mm:ss' }}</span></header>
            <ul><li *ngFor="let d of log.details">{{ d }}</li></ul>
          </article>
        </mat-card>
      </section>

      <aside class="offline" *ngIf="!(state$ | async)?.online">网络不可用：疑问已写入本地缓存；已发布版本不会被离线改动污染。</aside>
    </main>
  `,
  styles: [`
    .topbar { position: sticky; top: 0; z-index: 4; gap: 8px; }
    .topbar button { margin-left: 8px; }
    .spacer { flex: 1; }
    main { max-width: 1240px; margin: 24px auto; padding: 0 18px 64px; }
    main.rehearsal { max-width: 860px; background: #111827; color: #f9fafb; margin-top: 0; }
    .rules, .summary, .logs { margin-bottom: 18px; }
    .rules ol { margin: 10px 0 0; padding-left: 20px; line-height: 1.9; }
    .chips { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
    .lock-icon { font-size: 16px; width: 16px; height: 16px; margin-left: 4px; }
    .hint { color: #6b7280; font-size: 13px; display: flex; align-items: center; gap: 6px; margin: 8px 0 0; }
    .hint mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .workspace { display: grid; grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr); gap: 18px; align-items: start; }
    .side { display: flex; flex-direction: column; gap: 18px; }
    .freeze-tag { font-size: 12px; background: #e5e7eb; color: #374151; border-radius: 999px; padding: 2px 10px; margin-left: 8px; vertical-align: middle; }
    .line { cursor: grab; display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; padding: 16px 0; border-bottom: 1px solid #e5e7eb; }
    .line.locked { cursor: default; }
    .line-body { flex: 1; }
    .line p { margin: 8px 0; font-size: 17px; line-height: 1.6; }
    .flag-row { display: flex; gap: 8px; margin-top: 6px; align-items: center; }
    .flag-row input { flex: 1; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px; }
    .status { font-size: 12px; color: #b45309; }
    .status.ok { color: #15803d; }
    .qcount { font-size: 12px; color: #6d28d9; margin-left: 6px; }
    .outbox { list-style: none; margin: 8px 0; padding: 0; }
    .outbox li { display: flex; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px dashed #e5e7eb; font-size: 13px; }
    .outbox .err { color: #b91c1c; }
    .question { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; margin-top: 10px; background: #fafafa; }
    .question.rebased { border-left: 4px solid #15803d; }
    .question.suspended { border-left: 4px solid #b45309; background: #fffbeb; }
    .question header { display: flex; justify-content: space-between; align-items: center; }
    .question .note { margin: 6px 0; }
    .new-text { color: #15803d; font-size: 14px; margin: 6px 0; display: flex; gap: 6px; align-items: flex-start; }
    .old-text { color: #6b7280; font-size: 13px; text-decoration: none; margin: 6px 0; }
    .chip { font-size: 12px; border-radius: 999px; padding: 2px 10px; background: #e5e7eb; color: #374151; }
    .chip-rebased { background: #dcfce7; color: #15803d; }
    .chip-suspended { background: #fef3c7; color: #b45309; }
    .chip-failed { background: #fee2e2; color: #b91c1c; }
    .chip-pending { background: #e0e7ff; color: #4338ca; }
    .warn-card { border-color: #fcd34d; }
    .log { border-bottom: 1px solid #e5e7eb; padding: 10px 0; }
    .log header { display: flex; justify-content: space-between; color: #374151; }
    .log ul { margin: 6px 0 0; padding-left: 18px; font-size: 13px; color: #4b5563; }
    .offline { position: fixed; right: 18px; bottom: 18px; padding: 14px 18px; color: #fff; background: #b45309; border-radius: 10px; box-shadow: 0 8px 30px #0003; }
    @media (max-width: 900px) { .workspace { grid-template-columns: 1fr; } }
  `]
})
export class AppComponent implements OnInit, OnDestroy {
  readonly state$ = this.store.select('script');
  readonly activeVersion$ = this.store.select((state) => {
    const script = state.script as ScriptState;
    return script.versions.find((item) => item.id === script.activeVersionId) ?? script.versions[0];
  });
  private subscription?: Subscription;
  private onlineHandler = () => this.store.dispatch(setOnline({ online: navigator.onLine }));
  private offlineHandler = () => this.store.dispatch(setOnline({ online: false }));

  constructor(private readonly store: Store<{ script: ScriptState }>) {}

  ngOnInit() {
    window.addEventListener('online', this.onlineHandler);
    window.addEventListener('offline', this.offlineHandler);
    this.subscription = this.state$.subscribe((state) =>
      localStorage.setItem('yf52-script-state-v2', JSON.stringify(state))
    );
  }

  ngOnDestroy() {
    window.removeEventListener('online', this.onlineHandler);
    window.removeEventListener('offline', this.offlineHandler);
    this.subscription?.unsubscribe();
  }

  activate(id: string) { this.store.dispatch(activateVersion({ id })); }
  toggleRehearsal() { this.store.dispatch(toggleRehearsal()); }
  toggleSimulateFailure() { this.store.dispatch(toggleSimulateFailure()); }
  reset() {
    try { localStorage.removeItem('yf52-script-state-v2'); } catch { /* ignore */ }
    this.store.dispatch(resetScenario());
  }
  setOnline(online: boolean) { this.store.dispatch(setOnline({ online })); }
  toggleOnline() { this.state$.subscribe((state) => this.setOnline(!state.online)).unsubscribe(); }

  reviewLine(id: string, decision: 'accepted' | 'returned') { this.store.dispatch(reviewLine({ id, decision })); }
  reviewCue(id: string, decision: 'accepted' | 'returned') { this.store.dispatch(reviewCue({ id, decision })); }
  dropLine(event: CdkDragDrop<unknown>) {
    if (event.previousIndex !== event.currentIndex) this.store.dispatch(reorderLines({ from: event.previousIndex, to: event.currentIndex }));
  }

  submitDraft() { this.store.dispatch(submitPlaywrightDraft({ version: playwrightDraftV14() })); }
  hasV14(): boolean { return this.snapshot()?.versions.some((v) => v.id === 'v14') ?? false; }
  sync(forceFail?: boolean) { this.store.dispatch(syncQuestions({ failHalf: forceFail })); }
  resend(questionId: string) { this.store.dispatch(resendQuestion({ questionId })); }

  flag(target: 'line' | 'cue', targetId: string, versionId: string, note: string) {
    const text = note.trim();
    if (!text) return;
    this.store.dispatch(addQuestion({
      id: `q-${Date.now()}`,
      target,
      targetId,
      versionId,
      note: text,
      actor: '演员（离线标记）',
    }));
  }

  private snapshot(): ScriptState | undefined {
    let state: ScriptState | undefined;
    this.state$.subscribe((s) => (state = s)).unsubscribe();
    return state;
  }

  questionsOn(target: 'line' | 'cue', targetId: string): Question[] {
    return this.snapshot()?.questions.filter((q) => q.target === target && q.targetId === targetId) ?? [];
  }
  rebasedQuestions(): Question[] {
    return this.snapshot()?.questions.filter((q) => q.status === 'rebased') ?? [];
  }
  suspendedQuestions(): Question[] {
    return this.snapshot()?.questions.filter((q) => q.status === 'suspended') ?? [];
  }
  pendingQuestions(): Question[] {
    return this.snapshot()?.questions.filter((q) => q.status === 'pending' || q.status === 'failed') ?? [];
  }

  /** 疑问转挂后，在锚定版本里取编剧修订后的新文字；撤下则返回空 */
  currentText(question: Question): string {
    const state = this.snapshot();
    if (!state || !question.anchoredVersionId) return '';
    const version = state.versions.find((v) => v.id === question.anchoredVersionId);
    if (!version) return '';
    const item = (question.target === 'line' ? version.lines : version.cues).find((i) => i.id === question.targetId);
    return item?.text ?? '';
  }
}
