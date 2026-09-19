// candidates-game-anime-vtuber.md 를 읽어 곡마다 유튜브 영상을 고른다.
//
//   node resolve.mjs <md경로> <출력디렉터리> [--limit N] [--only 애니|게임|버튜버]
//
// 결과: questions-*.json (문제은행 포맷) + resolve-report.md (사람이 검수할 표)

import fs from 'node:fs/promises'
import path from 'node:path'
import { ytSearch } from './ytsearch.mjs'

const CLIP = 40 // 재생 구간 길이(초)

/* ---------------- md 파싱 ---------------- */

function splitRow(line) {
  return line
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())
}

function parseMd(md) {
  const lines = md.split(/\r?\n/)
  const out = []
  let genre = null

  for (const line of lines) {
    const h2 = line.match(/^##\s+(애니|게임|버튜버)\s/)
    if (h2) {
      genre = h2[1]
      continue
    }
    if (/^##\s/.test(line) && !h2) {
      // 다른 h2(제외한 곡 / 출처 등)로 넘어가면 수집 중단
      if (!/^###/.test(line)) genre = null
      continue
    }
    if (!genre) continue
    if (!line.startsWith('|')) continue

    const cells = splitRow(line)
    const no = parseInt(cells[0], 10)
    if (!Number.isFinite(no)) continue // 헤더·구분선

    if (genre === '애니') {
      const [, anime, song, artist, tags] = cells
      out.push({
        genre,
        no,
        slots: [
          { label: '애니 제목', answer: anime },
          { label: '노래 제목', answer: song },
        ],
        artist,
        tags,
        // 작품명을 넣은 검색과 곡+가수만 넣은 검색을 합친다.
        // 후자가 있어야 원곡 공식 채널(일본어 표기)이 올라온다.
        queries: [`${song} ${artist}`, `${anime} ${song} ${artist}`],
        kind: 'song',
      })
    } else if (genre === '게임') {
      const [, game, label, answer, ref, tags] = cells
      const isBgm = /BGM|보스전|맵/.test(`${label} ${tags}`)
      // 참고 칸의 "곡: OO" 는 검색에 쓰되 정답으로는 안 쓴다
      const refSong = (ref || '').replace(/^곡:\s*/, '')
      out.push({
        genre,
        no,
        slots: [
          { label: '게임 이름', answer: game },
          { label, answer },
        ],
        artist: ref,
        tags,
        queries: [
          `${game} ${answer} ${refSong} ${isBgm ? 'OST BGM' : ''}`.replace(/\s+/g, ' ').trim(),
          `${game} ${refSong || answer} theme soundtrack`.replace(/\s+/g, ' ').trim(),
        ],
        kind: isBgm ? 'bgm' : 'song',
      })
    } else if (genre === '버튜버') {
      const [, song, label, answer, tags] = cells
      out.push({
        genre,
        no,
        slots: [
          { label: '노래 제목', answer: song },
          { label, answer },
        ],
        artist: answer,
        tags,
        queries: [
          `${answer} ${song}`,
          label === '커버' ? `${answer} ${song} 커버` : `${answer} ${song} MV`,
        ],
        kind: label === '커버' ? 'cover' : 'song',
      })
    }
  }
  return out
}

/* ---------------- 채점 ---------------- */

const NEG = [
  [/1\s*hour|1시간|10\s*hours|반복|loop/i, -120],
  [/reaction|리액션/i, -150],
  [/nightcore|sped\s*up|배속|slowed/i, -100],
  [/shorts?\b/i, -60],
  [/tutorial|강좌|악보|sheet|튜토리얼/i, -80],
  [/piano|기타\s*커버|오르골|music\s*box|8[\s-]?bit|remix/i, -50],
  [/full\s*album|메들리|medley|모음|플레이리스트|playlist/i, -70],
  [/노래방|karaoke|instrumental|inst\./i, -60],
  // 가사·자막 재업로드 채널: 원본이 있으면 그쪽이 낫다
  [/가사|해석|자막|발음|lyrics?|번역|자막판/i, -55],
  // 라이브·페스 버전보다 음원/MV 가 낫다
  [/\blive\b|라이브|ライブ|콘서트|concert|\bfes(t|tival)?\b|페스/i, -85],
  // MAD·패러디 합성물
  [/\bmad\b|패러디|parody|합성|야매|짜집기/i, -90],
]

const POS = [
  [/official|오피셜|공식/i, 40],
  [/\bm\/?v\b|music\s*video|뮤직비디오/i, 35],
  [/\bost\b|original\s*soundtrack/i, 20],
  [/\btopic\b/i, 30],
]

function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[\s\-_·:'"!?,.()[\]{}~★☆♪♡]/g, '')
}

/** 이 레코드에서 "곡 제목"에 해당하는 문자열들 (괄호 안팎 표기 포함) */
function songKeys(rec) {
  const raw = []
  if (rec.genre === '게임') {
    raw.push(rec.slots[1].answer)
    const ref = (rec.artist || '').replace(/^곡:\s*/, '')
    if (ref && /곡:/.test(rec.artist || '')) raw.push(ref)
  } else {
    raw.push(rec.slots.find((x) => /노래 제목/.test(x.label))?.answer)
  }
  const keys = new Set()
  for (const r of raw.filter(Boolean)) {
    for (const v of acceptVariants(r)) {
      const n = loose(v)
      // 한자 한 글자(炎)는 곡 제목이 되지만, 한글 한 글자는 우연히 겹친다
      const min = /[㐀-鿿]/.test(n) ? 1 : 2
      if (n.length >= min) keys.add(n)
    }
  }
  return [...keys]
}

/** 소문자화 + 기호를 공백으로. 단어 경계를 살려둔다 */
function loose(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣぀-ヿ㐀-鿿]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

const WORDISH = /[0-9a-z가-힣぀-ヿ㐀-鿿]/

/**
 * 곡 제목이 영상 제목에 실제로 들어 있는지.
 *
 * "아이돌"이 "이세계아이돌" 안에 우연히 들어가는 걸 막으려고 앞뒤 글자가
 * 단어 문자면 탈락시킨다. 대신 "KICK BACK" ↔ "KICKBACK" 처럼 띄어쓰기만
 * 다른 경우를 놓치므로, 공백 뺀 형태로도 한 번 더 본다(5자 이상일 때만).
 */
function songTitleHit(c, rec) {
  const keys = songKeys(rec)
  if (!keys.length) return true // 판정할 근거가 없으면 통과시킨다
  const t = loose(c.title)
  const tNo = t.replace(/\s+/g, '')
  return keys.some((k) => {
    let from = 0
    while (true) {
      const at = t.indexOf(k, from)
      if (at === -1) break
      const before = t[at - 1]
      const after = t[at + k.length]
      if (!WORDISH.test(before || ' ') && !WORDISH.test(after || ' ')) return true
      from = at + 1
    }
    const kNo = k.replace(/\s+/g, '')
    return kNo.length >= 5 && tNo.includes(kNo)
  })
}

function scoreCandidate(c, rec, rank) {
  let s = 0
  s -= rank * 6 // 검색 상위일수록 유리

  const hay = `${c.title} ${c.channel}`
  for (const [re, pts] of NEG) if (re.test(hay)) s += pts
  for (const [re, pts] of POS) if (re.test(hay)) s += pts

  // 커버곡 후보에 cover 표기는 오히려 가점, 일반곡엔 감점
  if (/cover|커버|불러보았다|歌ってみた/i.test(hay)) s += rec.kind === 'cover' ? 40 : -70
  // BGM 항목엔 instrumental 감점을 되돌린다
  if (rec.kind === 'bgm' && /instrumental|inst\.|bgm|theme|테마/i.test(hay)) s += 70

  // 곡 제목이 영상 제목에 없으면 "같은 가수의 다른 곡"일 확률이 매우 높다.
  // 조용히 고르는 것보다 미확인으로 떨구는 편이 낫다.
  s += songTitleHit(c, rec) ? 90 : -150
  const art = normalize(rec.artist)
  if (art && art.length > 1) {
    // 채널명이 가수명이면 원본 채널일 확률이 높다
    if (normalize(c.channel).includes(art)) s += 70
    else if (normalize(c.title).includes(art)) s += 30
  }

  if (c.verified) s += 45

  // 게임은 맵/보스 이름이 다른 게임과 겹치는 일이 잦다("아침의 나라"는 검은사막에도 있다).
  // 그래서 게임 이름이 제목·채널에 보이는지를 강하게 따진다.
  if (rec.genre === '게임') {
    const game = normalize(rec.slots[0].answer)
    const shortGame = game.replace(/온라인|online|:.*$/g, '')
    s += normalize(hay).includes(shortGame) ? 80 : -70
  }

  // 길이: 1~8분이 정상, 그 밖은 감점
  if (c.seconds === 0) s -= 40
  else if (c.seconds < 60) s -= 80
  else if (c.seconds > 600) s -= 90
  else if (c.seconds > 480) s -= 40

  return s
}

/**
 * 정답 허용 표기를 넓힌다.
 * "炎 (호무라)" → 炎 / 호무라, "RE : WIND" → REWIND 처럼
 * 괄호 안팎과 공백 제거형을 같이 인정한다.
 */
function acceptVariants(answer) {
  const out = new Set([answer])
  const paren = answer.match(/^(.*?)\s*[(（]([^)）]+)[)）]\s*$/)
  if (paren) {
    out.add(paren[1].trim())
    out.add(paren[2].trim())
  }
  for (const v of [...out]) {
    const nospace = v.replace(/\s+/g, '')
    if (nospace && nospace !== v) out.add(nospace)
    // "A · B" 처럼 여러 명이 묶인 정답은 각각도 인정
    if (/[·,]/.test(v)) for (const part of v.split(/[·,]/)) {
      const t = part.trim()
      if (t.length > 1) out.add(t)
    }
  }
  return [...out].filter(Boolean)
}

/* ---------------- 실행 ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const [mdPath, outDir] = process.argv.slice(2)
  const args = process.argv.slice(4)
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null

  const md = await fs.readFile(mdPath, 'utf8')
  let recs = parseMd(md)
  if (only) recs = recs.filter((r) => r.genre === only)
  recs = recs.slice(0, limit)

  const picked = []
  for (const [i, rec] of recs.entries()) {
    process.stderr.write(`[${i + 1}/${recs.length}] ${rec.genre} ${rec.no} — ${rec.queries[0]}\n`)
    // 검색어별 결과를 합치되, 후보의 순위는 "가장 잘 나온 순위"로 본다
    const merged = new Map()
    for (const q of rec.queries) {
      let cands = []
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          cands = await ytSearch(q, { limit: 8 })
          if (cands.length) break
        } catch (e) {
          process.stderr.write(`   ! ${e.message}\n`)
        }
        await sleep(1500 * (attempt + 1)) // 빈 응답은 대개 일시적인 차단
      }
      if (!cands.length) process.stderr.write(`   ! 결과 없음: ${q}\n`)
      cands.forEach((c, idx) => {
        const prev = merged.get(c.id)
        if (!prev) merged.set(c.id, { ...c, rank: idx })
        else prev.rank = Math.min(prev.rank, idx)
      })
      await sleep(350)
    }
    const ranked = [...merged.values()]
      .map((c) => ({ ...c, score: scoreCandidate(c, rec, c.rank) }))
      .sort((a, b) => b.score - a.score)
    picked.push({ ...rec, cands: ranked })
    await sleep(350)
  }

  await fs.mkdir(outDir, { recursive: true })

  // 문제은행 JSON
  const byGenre = {}
  for (const p of picked) {
    const best = p.cands[0]
    if (!best) continue
    const start = Math.max(20, Math.min(Math.round(best.seconds * 0.3), best.seconds - CLIP - 5))
    const genreName = p.genre
    ;(byGenre[genreName] ||= []).push({
      youtubeUrl: `https://www.youtube.com/watch?v=${best.id}`,
      startSec: start,
      endSec: start + CLIP,
      genreName,
      tags: (p.tags || '').split('·').map((t) => t.trim()).filter(Boolean),
      slots: p.slots.map((s) => ({
        label: s.label,
        answer: s.answer,
        acceptAnswers: acceptVariants(s.answer),
      })),
    })
  }
  const fileFor = { 애니: 'anime', 게임: 'game', 버튜버: 'vtuber' }
  for (const [g, rows] of Object.entries(byGenre)) {
    const f = path.join(outDir, `questions-${fileFor[g]}-new.json`)
    await fs.writeFile(f, JSON.stringify(rows, null, 2) + '\n', 'utf8')
    process.stderr.write(`→ ${f} (${rows.length})\n`)
  }

  // 검수용 리포트
  let rep = '# 유튜브 매칭 검수표\n\n선정된 영상이 실제로 그 곡인지 확인용. `대안` 칸은 2·3순위.\n\n'
  for (const g of ['애니', '게임', '버튜버']) {
    const rows = picked.filter((p) => p.genre === g)
    if (!rows.length) continue
    rep += `\n## ${g}\n\n| # | 신뢰 | 정답 | 고른 영상 | 채널 | 길이 | 링크 | 대안 |\n|---|---|---|---|---|---|---|---|\n`
    for (const p of rows) {
      const b = p.cands[0]
      const ans = p.slots.map((s) => s.answer).join(' / ')
      if (!b) {
        rep += `| ${p.no} | ⚠ | ${ans} | **검색 실패** | | | | |\n`
        continue
      }
      const ok = songTitleHit(b, p) ? '' : '⚠'
      const alts = p.cands
        .slice(1, 3)
        .map((c) => `${c.title.slice(0, 40)} (${c.id})`)
        .join('<br>')
      rep += `| ${p.no} | ${ok} | ${ans} | ${b.title.replace(/\|/g, '/')} | ${b.channel.replace(/\|/g, '/')} | ${b.length} | https://youtu.be/${b.id} | ${alts.replace(/\|/g, '/')} |\n`
    }
  }
  await fs.writeFile(path.join(outDir, 'resolve-report.md'), rep, 'utf8')
  process.stderr.write(`→ ${path.join(outDir, 'resolve-report.md')}\n`)
}

await main()
