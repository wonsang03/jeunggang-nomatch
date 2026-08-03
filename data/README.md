# 문제 JSON 배치 (DB 반영용 백업)

이미 은행에 들어간 곡 목록입니다. 재반영:

```bash
cd server
node scripts/apply-question-jsons.mjs ../data/questions-gg-batch2.json
# 또는
node scripts/upsert-questions-json.mjs ../data/questions-gg-batch1.json
```
