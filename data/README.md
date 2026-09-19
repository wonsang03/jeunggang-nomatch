# 문제 JSON 배치 (DB 반영용 백업)

이미 은행에 들어간 곡 목록입니다. 유튜브 ID 기준 **upsert**라 여러 번 돌려도 중복이 안 생깁니다.

둘 다 관리자 API를 타므로 **서버가 떠 있어야** 합니다 (주소는 `API_BASE` 로 바꿀 수 있고, 기본값은 `http://127.0.0.1:4000`).

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

레코드 한 개는 `youtubeUrl` · `startSec` · `endSec` · `genreName` · `tags` · `slots[{label, answer, acceptAnswers}]` 꼴입니다.

## 관련 스크립트

| 스크립트 | 역할 |
|----------|------|
| `server/scripts/export-questions-dump.mjs` | 현재 DB 문제은행을 통째로 덤프 |
| `server/scripts/import-questions-dump.mjs` | 덤프를 DB에 되돌림 |
| `server/scripts/report-song-bank.mjs` | 장르별 곡 수 리포트 |
| `server/scripts/dedupe-questions.mjs` · `dedupe-by-title.mjs` | 중복 곡 정리 |
