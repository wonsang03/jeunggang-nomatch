# 문제 JSON 배치 (DB 반영용 백업)

이미 은행에 들어간 곡 목록입니다. 유튜브 ID 기준 **upsert**라 여러 번 돌려도 중복이 안 생깁니다.

둘 다 관리자 API를 타므로 **서버가 떠 있어야** 하고, 관리자 계정이 있어야 합니다 (시드 기본 계정은 이제 `SEED_DEFAULT_ACCOUNTS=1` 일 때만 생김) (주소는 `API_BASE` 로 바꿀 수 있고, 기본값은 `http://127.0.0.1:4000`).

```bash
cd server

# 여러 파일 한 번에
node scripts/apply-question-jsons.mjs ../data/questions-new-kr-100.json ../data/questions-new-jp-50.json

# 한 파일씩
node scripts/upsert-questions-json.mjs ../data/questions-gg-batch1.json
```

## 파일

| 파일 | 장르 | 곡 수 |
|------|------|------|
| `questions-new-kr-100.json` | 한국노래 | 100 |
| `questions-gg-batch2.json` | 한국노래 | 87 |
| `questions-chart-ballad-72.json` | 한국노래 | 72 |
| `questions-gg-batch1.json` | 한국노래 | 36 |
| `questions-batch2-partA~D.json` | 한국노래 | 21 + 22 + 22 + 22 |
| `questions-new-jp-50.json` | 일본노래 | 50 |
| `questions-jp-course678.json` | 일본노래 | 15 |
| `questions-new-en-50.json` | 해외노래 | 50 |

`questions-chart-ballad-72.meta.json`은 곡 데이터가 아니라 그 배치의 **선정 기록**입니다.

## 게임 · 애니 · 버튜버 후보곡 (`draft/`)

[candidates-game-anime-vtuber.md](candidates-game-anime-vtuber.md) 에서 곡을 고르고 →
`resolve.mjs` 가 유튜브 영상을 매칭 → 사람이 [draft/resolve-report.md](draft/resolve-report.md) 로 검수하는 흐름입니다.

| 파일 | 장르 | 초안 | 검수 통과(`clean-*`) · DB 반영 |
|------|------|------|------|
| `draft/questions-anime-50.json` | 애니 | 50 | 42 ✅ |
| `draft/questions-game-51.json` | 게임 | 51 | 38 ✅ |
| `draft/questions-vtuber-61.json` | 버튜버 | 61 | 53 ✅ |

`clean-*.json` 만 은행에 들어갔습니다. 빠진 29곡(애니 8 · 게임 13 · 버튜버 8)은 영상을 다시 찾아야 합니다.

```bash
cd server
node scripts/resolve.mjs ../data/candidates-game-anime-vtuber.md ../data/draft [--only 애니|게임|버튜버]
node scripts/import-candidates.mjs --dry ../data/draft/clean-*.json   # 먼저 확인
node scripts/import-candidates.mjs ../data/draft/clean-*.json         # dev.db 에 바로 upsert (서버 불필요)
```

레코드 한 개는 `youtubeUrl` · `startSec` · `endSec` · `genreName` · `tags` · `slots[{label, answer, acceptAnswers}]` 꼴입니다.

## 관련 스크립트

| 스크립트 | 역할 |
|----------|------|
| `server/scripts/export-questions-dump.mjs` | 현재 DB 문제은행을 통째로 덤프 |
| `server/scripts/import-questions-dump.mjs` | 덤프를 DB에 되돌림 |
| `server/scripts/report-song-bank.mjs` | 한국·일본·해외 검수표(`문제은행-검수.md`)를 루트에 생성 · `npx tsx` 로 실행 |
| `server/scripts/dedupe-questions.mjs` · `dedupe-by-title.mjs` | 중복 곡 정리 |
| `server/scripts/resolve.mjs` · `ytsearch.mjs` | 후보곡 목록 → 유튜브 영상 매칭 (API 키 없이 검색 결과 파싱) |
| `server/scripts/import-candidates.mjs` | draft JSON을 Prisma로 dev.db 에 직접 upsert (관리자 로그인 불필요) |
