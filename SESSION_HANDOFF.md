# セッション引き継ぎノート / Session Handoff

WFITN Neurovascular Anatomy Course（Zurich 2026）の試験アプリ。
このファイルは、別の PC や別セッションから作業を引き継ぐための記録です。

最終更新: 2026-06-10

---

## 1. これは何のアプリか

参加者約50名がスマホで解く、脳神経血管内治療の血管解剖 40問（5択・1〜2個選択）の
Web 試験アプリ。Node.js (Express) + PostgreSQL、Railway にデプロイ。

**主な機能**
- QR コードからアクセス → 参加者登録（氏名・性別・所属・卒後年数・専門・メール）
- 試験前に **AI 使用禁止の同意画面**（同意後に30分タイマー開始。リロードしても延長不可）
- 40問・各5択（a〜e）から正解を1つまたは2つ選択。完全一致でのみ正解
- 提出後すぐに **得点・順位・偏差値**を表示
- 誤答の解答＋解説は **管理者が「Publish answers」を押すまで非表示**（早く出した人が答えを見られないように）
- 管理画面：集計・上位5名・**成績順ランキング**・**正解率ワースト10**・Excel 出力
- （任意）SMTP 設定で誤答解説をメール送信

---

## 2. リポジトリと構成

- GitHub: **`michihiro1966/WFITN-exam-4`**（ブランチ `main` が本番）
- 主要ファイル:

```
src/      Express サーバー・設定・DB・採点・問題ビルダー
public/   参加者/管理画面（静的 HTML・/ で配信）
data/     questions.json（採点・解説に使う40問。R4版）
cerebrovascular_MCQ_select1or2_variant_R4.md   出題の元データ（R4）
README.md   概要・Railway 手順
DEPLOY.md   印刷用の当日運用チェックリスト
```

---

## 3. 他の PC で編集・実行する方法

```bash
# 1. クローン
git clone https://github.com/michihiro1966/WFITN-exam-4.git
cd WFITN-exam-4

# 2. 依存インストール（Node.js 20+ が必要）
npm install

# 3. ローカル実行には PostgreSQL が必要
cp .env.example .env
#   .env を編集して DATABASE_URL と ADMIN_PASSWORD を設定
npm run dev          # 開発起動（http://localhost:3000）

# その他
npm run validate         # 40問の検証
npm run build:questions  # .md から questions.json を再生成
```

- 参加者入口: `/`  ・ 管理画面: `/admin`  ・ ヘルスチェック: `/health`
- 採点ルール: 選んだ集合が正解集合と**完全一致**したときのみ正解。

---

## 4. Railway デプロイの現状（重要）

- 本番プロジェクト: **`wfitn-exam-2026`**（他に `wfitn-eval-app`・`neurosurgery-board-exam` は別用途で残す）
- 公開 URL: **`https://wfitn-exam-2026-production.up.railway.app`**
- プロジェクト内に **PostgreSQL** あり（Online）
- アプリサービスの **Source = GitHub `Michihiro1966/WFITN-exam-4` / branch `main`**
- 環境変数（Variables）:
  - `ADMIN_PASSWORD` … 設定済み
  - `DATABASE_URL` … 設定済み（`${{Postgres.DATABASE_URL}}` のリファレンス）
  - `PORT` … Railway 用（触らない）

### 既知の状態 / 残作業
1. **古い CLI デプロイ（`railway up`・約1か月前）が ACTIVE のまま**で、`/health` が
   `Cannot GET /health` を返す（＝最新コードがまだ反映されていない）。
2. Railway 画面に **「Apply 3 changes」＋紫の「Deploy」ボタン**が出ている。
   → **この「Deploy」ボタンを押す**と、`DATABASE_URL` 等の変更が適用され、
   GitHub `main` の最新コミットでビルド＆デプロイされる（これが残りの最後の操作）。
3. Source に **「Auto deploy unavailable」**表示あり（push での自動デプロイが無効）。
   - 当面は手動 Deploy で問題なし。
   - 恒久対応するなら: Source Repo 横の ✏️ または `(?)` から
     **Railway の GitHub App に `WFITN-exam-4` へのアクセスを許可**して自動デプロイを有効化。

### デプロイ成功の確認
- Deployments → **Deployment successful**、View logs に
  `WFITN Neurovascular Anatomy Course Zurich 2026 running on port ...`
- `https://wfitn-exam-2026-production.up.railway.app/health` → `{"ok":true,...}`
- `/` 登録後に **AI 同意画面**、`/admin` に **Publish answers** ボタンが出れば最新版

---

## 5. Railway 環境変数（参考・全項目）

| 変数 | 値 | 要否 |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | 必須 |
| `ADMIN_PASSWORD` | 強いパスワード | 必須 |
| `APP_BASE_URL` | `https://wfitn-exam-2026-production.up.railway.app` | 推奨（QR/メールのリンク用） |
| `COURSE_NAME` | `WFITN Neurovascular Anatomy Course Zurich 2026` | 任意 |
| `EXAM_DURATION_MINUTES` | `30` | 任意 |
| `AVATAR_URL` | `https://avatars.githubusercontent.com/u/269770510?v=4` | 任意 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | メール送信用 | 任意 |
| `PGSSLMODE` | 公開DB URL接続時のみ `require` | 任意 |

---

## 6. 当日の運用フロー（詳細は DEPLOY.md）

1. 試験中〜全員提出まで → 解説は **非公開（🔒）**のまま（受験者は得点・順位・偏差値のみ）
2. 管理者が集計（ランキング・ワースト10 確認、Excel 出力）
3. 上位5名を表彰
4. **「Publish answers」を押す** → 全受験者の結果画面に誤答解説が自動表示（開いている画面は約15秒で更新）

---

## 7. DB リセット（リハーサル後など）

Railway の Postgres でクエリ実行:

```sql
TRUNCATE responses, participants RESTART IDENTITY CASCADE;
DELETE FROM settings WHERE key = 'answers_revealed';
```

問題データはコード側（`data/questions.json`）にあるため影響なし。

---

## 8. 次にやること（チェックリスト）

- [ ] Railway `wfitn-exam-2026` のアプリサービスで **紫の「Deploy」ボタンを押す**
- [ ] `/health` が `{"ok":true,...}` を返すことを確認
- [ ] `/` の AI 同意画面、`/admin` の Publish answers ボタンを確認
- [ ] `APP_BASE_URL` を公開ドメインに設定
- [ ] （任意）GitHub App 許可で自動デプロイを有効化
- [ ] ダミー受験者で通しリハーサル（登録→同意→受験→採点→公開→Excel）
- [ ] リハーサル後に DB をリセットして本番に備える
