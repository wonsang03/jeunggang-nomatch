import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { BANK_GENRES } from '../src/genres.js'

const prisma = new PrismaClient()

async function main() {
  const adminHash = await bcrypt.hash('admin1234', 10)
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: adminHash,
      nickname: '관리자',
      isAdmin: true,
    },
  })

  const userHash = await bcrypt.hash('test1234', 10)
  await prisma.user.upsert({
    where: { username: 'test' },
    update: {},
    create: {
      username: 'test',
      passwordHash: userHash,
      nickname: '멜로디킹',
      isAdmin: false,
    },
  })

  const genreIds: Record<string, string> = {}
  for (const name of BANK_GENRES) {
    const g = await prisma.genre.upsert({
      where: { name },
      update: {},
      create: { name },
    })
    genreIds[name] = g.id
  }

  // 예전 장르명 → 새 장르로 이전 후 삭제
  const legacyMap: Record<string, string> = {
    'K-POP': '한국노래',
    'K팝': '한국노래',
    'J-POP': '일본노래',
    '제이팝': '일본노래',
    '팝': '해외노래',
    '발라드': '한국노래',
  }
  for (const [oldName, newName] of Object.entries(legacyMap)) {
    if (oldName === newName) continue
    const old = await prisma.genre.findUnique({ where: { name: oldName } })
    if (!old) continue
    const targetId = genreIds[newName]
    if (!targetId) continue
    await prisma.question.updateMany({ where: { genreId: old.id }, data: { genreId: targetId } })
    await prisma.genre.delete({ where: { id: old.id } }).catch(() => {})
  }

  // 클래식: 장르·곡 모두 삭제 (야차/기타로 옮기지 않음)
  {
    const classic = await prisma.genre.findUnique({ where: { name: '클래식' } })
    if (classic) {
      await prisma.question.deleteMany({ where: { genreId: classic.id } })
      await prisma.genre.delete({ where: { id: classic.id } }).catch(() => {})
    }
  }

  const existing = await prisma.question.count()
  if (existing < 5) {
    const samples = [
      {
        youtubeUrl: 'https://www.youtube.com/watch?v=d9IxdwEFk1c',
        startSec: 30, endSec: 70, genreId: genreIds['한국노래'],
        slots: [
          { label: '노래 제목', answer: '밤편지', acceptAnswers: JSON.stringify(['밤편지']), sortOrder: 0 },
          { label: '가수', answer: 'IU', acceptAnswers: JSON.stringify(['IU', '아이유', 'iu']), sortOrder: 1 },
        ],
      },
      {
        youtubeUrl: 'https://www.youtube.com/watch?v=JHJ1OwzHtbE',
        startSec: 40, endSec: 80, genreId: genreIds['한국노래'],
        slots: [
          { label: '노래 제목', answer: '봄날', acceptAnswers: JSON.stringify(['봄날', 'Spring Day']), sortOrder: 0 },
          { label: '가수', answer: 'BTS', acceptAnswers: JSON.stringify(['BTS', '방탄소년단', 'bts']), sortOrder: 1 },
        ],
      },
      {
        youtubeUrl: 'https://www.youtube.com/watch?v=9bZkp7q19f0',
        startSec: 50, endSec: 90, genreId: genreIds['한국노래'],
        slots: [
          { label: '노래 제목', answer: '강남스타일', acceptAnswers: JSON.stringify(['강남스타일', 'Gangnam Style']), sortOrder: 0 },
          { label: '가수', answer: 'PSY', acceptAnswers: JSON.stringify(['PSY', '싸이', 'psy']), sortOrder: 1 },
        ],
      },
      {
        youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        startSec: 10, endSec: 50, genreId: genreIds['일본노래'],
        slots: [
          { label: '노래 제목', answer: 'Pretender', acceptAnswers: JSON.stringify(['Pretender', '프리텐더']), sortOrder: 0 },
          { label: '가수', answer: 'Official髭男dism', acceptAnswers: JSON.stringify(['Official髭男dism', '히게단', '髭男']), sortOrder: 1 },
        ],
      },
      {
        youtubeUrl: 'https://www.youtube.com/watch?v=2iFZFY6iFBI',
        startSec: 20, endSec: 60, genreId: genreIds['애니'],
        slots: [
          { label: '애니 제목', answer: '너의 의미', acceptAnswers: JSON.stringify(['너의의미', '너의 의미']), sortOrder: 0 },
          { label: '가수', answer: 'IU', acceptAnswers: JSON.stringify(['IU', '아이유', 'iu']), sortOrder: 1 },
        ],
      },
    ]
    for (const q of samples) {
      await prisma.question.create({
        data: {
          youtubeUrl: q.youtubeUrl,
          startSec: q.startSec,
          endSec: q.endSec,
          genreId: q.genreId,
          slots: { create: q.slots },
        },
      })
    }
  }

  // 끄적.txt 기준 증강 등록 (사진 있는 것만 imageUrl)
  await prisma.augment.deleteMany({})
  const augments = [
    {
      name: '리신',
      description: '장르 및 힌트를 못 보는 대신, 점수 2배 (사용 즉시부터 3라운드)',
      effectType: 'score_mult_no_hint',
      effectValue: JSON.stringify({ mult: 2, rounds: 3 }),
      tier: 'gold',
      imageUrl: '/augments/leesin.jpg' as string | null,
    },
    {
      name: '청각X',
      description: '장르·초성 힌트만으로 맞추기. 점수 2배 (사용 즉시부터 3라운드)',
      effectType: 'score_mult_hint_only',
      effectValue: JSON.stringify({ mult: 2, rounds: 3 }),
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '신창섭의 가호',
      description: '모든 플레이어의 점수를 현재 평균값으로 통일합니다.',
      effectType: 'equalize_scores',
      effectValue: '{}',
      tier: '가호',
      imageUrl: '/augments/sinchangseop-gaho.jpg',
    },
    {
      name: '엄',
      description: '엄마가 (엄→준→식 순서, 3개 모으면 서상원 깊티)',
      effectType: 'collect_piece',
      effectValue: JSON.stringify({ set: 'eomjunshik', piece: '엄', requires: [] }),
      tier: 'bronze',
      imageUrl: '/augments/eomjunshik.jpg',
    },
    {
      name: '준',
      description: '준비한 (엄 획득 후 등장, 3개 모으면 서상원 깊티)',
      effectType: 'collect_piece',
      effectValue: JSON.stringify({ set: 'eomjunshik', piece: '준', requires: ['엄'] }),
      tier: 'bronze',
      imageUrl: '/augments/eomjunshik.jpg',
    },
    {
      name: '식',
      description: '식사 (준 획득 후 등장, 3개 모으면 서상원 깊티)',
      effectType: 'collect_piece',
      effectValue: JSON.stringify({ set: 'eomjunshik', piece: '식', requires: ['준'] }),
      tier: 'bronze',
      imageUrl: '/augments/eomjunshik.jpg',
    },
    {
      name: '서상원의 가호',
      description: '시작 10초 뒤 정답을 1초 동안 보여줍니다 (사용 즉시부터 8라운드)',
      effectType: 'flash_answer',
      effectValue: JSON.stringify({ delaySec: 10, ms: 1000, rounds: 8 }),
      tier: '가호',
      imageUrl: '/augments/seosangwon-gaho.jpg',
    },
    {
      name: '신동혁의 가호',
      description: '시작 7초 뒤부터 답이 한 글자씩 공개됩니다 (괄호 안 제외 · 한글 1자/초, 알파벳 2자/초 · 사용 즉시부터 8라운드)',
      effectType: 'delayed_answer',
      effectValue: JSON.stringify({ delaySec: 7, rounds: 8, charIntervalMs: 1000 }),
      tier: '가호',
      imageUrl: '/augments/sindonghyeok-gaho.jpg',
    },
    {
      name: '미룬이의 가호',
      description: '다음 라운드부터 5라운드 동안 다른 사람이 먼저 맞힌 정답도 라운드를 스킵하기 전까지 제출하면 정답으로 인정됩니다.',
      effectType: 'late_answer',
      effectValue: JSON.stringify({ rounds: 5 }),
      tier: '가호',
      imageUrl: '/augments/miruni-gaho.png',
    },
    {
      name: '김동주의 가호',
      description: '지금부터 8라운드 동안 게임 분야에서 정답을 공개합니다',
      effectType: 'reveal_game_song',
      effectValue: JSON.stringify({ rounds: 8 }),
      tier: '가호',
      imageUrl: '/augments/kimdongju-gaho.jpg',
    },
    {
      name: '예의바른청년',
      description:
        '플레이어를 지목합니다. 다음 3라운드 동안 그 플레이어는 답 끝에 「입니다」를 붙여야 정답으로 인정됩니다.',
      effectType: 'polite_suffix',
      effectValue: JSON.stringify({ rounds: 3, suffix: '입니다' }),
      tier: 'gold',
      imageUrl: '/augments/polite-youth.jpg',
    },
    {
      name: '쉬었음청년',
      description:
        '플레이어를 지목합니다. 다음 3라운드 동안 매 라운드 시작 시 5초간 채팅·제출이 막힙니다.',
      effectType: 'soft_chat_mute',
      effectValue: JSON.stringify({ rounds: 3, muteSec: 5 }),
      tier: 'silver',
      imageUrl: '/augments/rested-youth.jpg',
    },
    {
      name: '반전 술식',
      description:
        '남은 곡 중 가장 적은 장르와 가장 많은 장르의 잔량을 서로 바꿉니다. (예: 해외노래 10 · 한국노래 20 → 해외노래 20 · 한국노래 10)',
      effectType: 'swap_genre_counts',
      effectValue: '{}',
      tier: 'silver',
      imageUrl: '/augments/reversal-jutsu.jpg',
    },
    {
      name: '산데비스탄',
      description:
        '플레이어 한 명을 지목합니다. 산데비스탄 덕분에 모든 것이 느리게 느껴진다! 다음 3라운드 동안 대상의 노래 배속이 0.6~0.4 중 랜덤으로 적용됩니다.',
      effectType: 'slow_playback',
      effectValue: JSON.stringify({ rounds: 3, rateMin: 0.4, rateMax: 0.6 }),
      tier: 'gold',
      imageUrl: '/augments/sandevistan.jpg',
    },
    {
      name: '무지개 반사',
      description:
        '다른 플레이어가 나를 대상으로 디버프를 쓰면 자동으로 발동해 효과를 시전자에게 되돌려줍니다. (1회 · 수동 사용 불가)',
      effectType: 'reflect_debuff',
      effectValue: '{}',
      tier: 'gold',
      imageUrl: '/augments/rainbow-reflect.jpg',
    },
    {
      name: '신속정확대리',
      description:
        '플레이어 한 명을 지목합니다(대상 비공개). 그 플레이어가 정답을 맞히면 점수가 적립되고, 3라운드 후 본인 점수로 결산됩니다.',
      effectType: 'answer_proxy',
      effectValue: JSON.stringify({ rounds: 3 }),
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '혼돈',
      description:
        '가호를 제외한 모든 등급에서 랜덤한 증강 2개의 효과를 즉시 사용합니다. 대상 지정형은 대상도 랜덤입니다. (혼돈·가호선택·전환 제외)',
      effectType: 'chaos_cast',
      effectValue: '{}',
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '트루먼쇼',
      description:
        '본인을 제외한 플레이어를 1~2명 직접 골라 몰래 「트루먼」으로 만듭니다. 다음 2라운드 동안 그 사람들만 같은 장르의 다른 노래·정답을 듣고, 맞히면 채팅·점수판에 +1처럼 보이지만 가짜입니다. 다른 증강은 그대로 사용할 수 있으며, 사용·대상은 공개되지 않고 끝나면 「당신은 트루먼이었습니다」가 공개됩니다.',
      effectType: 'sakura_decoy',
      effectValue: JSON.stringify({ rounds: 2, targetSelection: 'multiple', minTargets: 1, maxTargets: 2 }),
      tier: 'gold',
      imageUrl: '/augments/truman-show.jpg',
    },
    {
      name: '점수가 2배',
      description: '지금부터 4라운드 동안 일반 슬롯 점수를 2배로 얻습니다. (히든 슬롯에는 적용되지 않습니다)',
      effectType: 'score_mult',
      effectValue: JSON.stringify({ mult: 2, rounds: 4, excludeHidden: true }),
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '님아 매너좀',
      description:
        '플레이어 한 명을 선택합니다. 다음 5라운드 동안 그 플레이어는 매 라운드 시작 5초 뒤에만 정답을 입력할 수 있습니다.',
      effectType: 'answer_delay',
      effectValue: JSON.stringify({ rounds: 5, delaySec: 5 }),
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '맞췄죠?',
      description:
        '지금부터 1라운드 동안 정답을 하나라도 맞히면 +5점입니다. (실패해도 감점 없음)',
      effectType: 'wager_answer',
      effectValue: JSON.stringify({ rounds: 1, bonus: 5, penalty: 0 }),
      tier: 'gold',
      imageUrl: '/augments/got-it-right.jpg',
    },
    {
      name: '히든런',
      description:
        '지금부터 3라운드 동안 히든 ×3 · 일반 슬롯 0점. 시전자만 히든을 즉시 보고 맞힐 수 있으며, 다른 사람은 일반 슬롯을 모두 맞춰야 히든이 열립니다.',
      effectType: 'hidden_run',
      effectValue: JSON.stringify({ rounds: 3, mult: 3 }),
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '슬로우 스타터',
      description:
        '다음 라운드부터 3라운드 동안 본인에게만 노래가 라운드 시작 7초 뒤에 들립니다. 문제를 맞히면 2점을 추가로 얻습니다.',
      effectType: 'slow_starter',
      effectValue: JSON.stringify({ rounds: 3, delaySec: 7, bonus: 2 }),
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '풍악을 울려라',
      description:
        '다음 3라운드 동안 본인을 제외한 모든 플레이어에게 방 노래와 풍악이 같이 들립니다. 정답은 원래 문제 기준입니다.',
      effectType: 'party_music_others',
      effectValue: JSON.stringify({ rounds: 3, youtubeUrl: 'https://www.youtube.com/watch?v=xAMsfKTCxpg', startSec: 0 }),
      tier: 'gold',
      imageUrl: '/augments/pungak.jpg',
    },
    {
      name: '야차룰',
      description:
        '플레이어 한 명을 지목해 1대1을 예약합니다. 컷신 후 제목만 맞히며 패자 −5점. 시전자는 초성 선공개, 대상은 노래가 5초 늦게 들립니다.',
      effectType: 'yacha_duel',
      effectValue: JSON.stringify({ penalty: 5, casterEarlyChosung: true, targetAudioDelaySec: 5 }),
      tier: 'gold',
      imageUrl: '/augments/yacha-rule.jpg',
    },
    {
      name: '박진성의 가호',
      description:
        '점프를 뜁니다! 자신과 등수가 가장 가까운 사람과 동점이 됩니다. (거리가 같으면 위 등수 우선)',
      effectType: 'rank_jump_tie',
      effectValue: '{}',
      tier: '가호',
      imageUrl: '/augments/parkjinseong-gaho.jpg',
    },
    {
      name: '일론 머스크의 가호',
      description:
        '화성에 있는 외계인과 접촉합니다. 지금부터 5라운드 동안 모든 정답 슬롯(히든·애니/게임 제목 등 포함)을 알 수 있지만, 외계인은 한국어가 미숙해서 영타(정답→wjdekq)로 표기됩니다.',
      effectType: 'alien_qwerty_answer',
      effectValue: JSON.stringify({ rounds: 5 }),
      tier: '가호',
      imageUrl: '/augments/elon-musk-gaho.jpg',
    },
    {
      name: '물귀신',
      description:
        '선택 시 자동 적용. 이번 라운드에서 모든 정답을 혼자 맞히지 못하면, 정답을 맞힌 다른 플레이어들은 각 −2점이고 본인은 +1점을 얻습니다.',
      effectType: 'water_ghost',
      effectValue: JSON.stringify({ rounds: 1, penalty: 2, gain: 1 }),
      tier: 'silver',
      imageUrl: null,
    },
    {
      name: '콤보',
      description:
        '선택 시 자동 적용. 최대 3라운드 동안 매 라운드 1회 이상 정답해야 유지되며, 기간 종료 시 그동안 얻은 점수가 한 번 더 더해집니다(×2). 한 라운드라도 미득점이면 즉시 종료.',
      effectType: 'combo_clear_double',
      effectValue: JSON.stringify({ rounds: 3 }),
      tier: 'silver',
      imageUrl: null,
    },
    {
      name: '습박 돌던져',
      description:
        '플레이어를 지목해 돌을 던집니다. 50%로 맞히면 1점을 뺏고, 성공할 때마다 다시 던집니다. 빗나가면 거기서 끝입니다.',
      effectType: 'steal_chain',
      effectValue: JSON.stringify({ hitChance: 0.5, amount: 1 }),
      tier: 'silver',
      imageUrl: '/augments/throw-rock.jpg',
    },
    {
      name: '넘어가요!',
      description: '사용하면 지금 재생 중인 문제를 강제 스킵합니다. (1회 · 플레이 중에만)',
      effectType: 'force_skip',
      effectValue: JSON.stringify({ charges: 1 }),
      tier: 'bronze',
      imageUrl: null,
    },
    {
      name: '넘어가요!!',
      description: '사용하면 지금 재생 중인 문제를 강제 스킵합니다. (2회 · 플레이 중에만)',
      effectType: 'force_skip',
      effectValue: JSON.stringify({ charges: 2 }),
      tier: 'silver',
      imageUrl: null,
    },
    {
      name: '넘어가요!!!!',
      description: '사용하면 지금 재생 중인 문제를 강제 스킵합니다. (3회 · 플레이 중에만)',
      effectType: 'force_skip',
      effectValue: JSON.stringify({ charges: 3 }),
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '기생수',
      description:
        '플레이어 한 명을 지목합니다. 다음 5라운드 동안 서로 정답으로 얻은 점수가 같이 오릅니다.',
      effectType: 'score_share',
      effectValue: JSON.stringify({ rounds: 5 }),
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '피치카토!',
      description:
        '플레이어를 지목합니다. 다음 1라운드 동안 그 플레이어에게 노래가 1초 들리고 1초 안 들리기를 반복합니다.',
      effectType: 'audio_stutter',
      effectValue: JSON.stringify({ rounds: 1, onMs: 1000, offMs: 1000 }),
      tier: 'bronze',
      imageUrl: null,
    },
    {
      name: '마르카토!!',
      description:
        '플레이어를 지목합니다. 다음 3라운드 동안 그 플레이어에게 노래가 1초 들리고 1초 안 들리기를 반복합니다.',
      effectType: 'audio_stutter',
      effectValue: JSON.stringify({ rounds: 3, onMs: 1000, offMs: 1000 }),
      tier: 'silver',
      imageUrl: null,
    },
    {
      name: '스타카토!!!',
      description:
        '플레이어를 지목합니다. 다음 5라운드 동안 그 플레이어에게 노래가 1초 들리고 1초 안 들리기를 반복합니다.',
      effectType: 'audio_stutter',
      effectValue: JSON.stringify({ rounds: 5, onMs: 1000, offMs: 1000 }),
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '알레그로',
      description:
        '플레이어를 지목합니다. 다음 4라운드 동안 그 플레이어의 노래 배속이 2~3배 중 랜덤으로 빨라집니다.',
      effectType: 'slow_playback',
      effectValue: JSON.stringify({ rounds: 4, rateMin: 2, rateMax: 3 }),
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '눈찌르기!',
      description:
        '플레이어를 지목합니다. 다음 1라운드 동안 그 플레이어는 장르·초성 등 힌트를 볼 수 없습니다.',
      effectType: 'hide_hints',
      effectValue: JSON.stringify({ rounds: 1 }),
      tier: 'bronze',
      imageUrl: null,
    },
    {
      name: '눈찌르기!!',
      description:
        '플레이어를 지목합니다. 다음 3라운드 동안 그 플레이어는 장르·초성 등 힌트를 볼 수 없습니다.',
      effectType: 'hide_hints',
      effectValue: JSON.stringify({ rounds: 3 }),
      tier: 'silver',
      imageUrl: null,
    },
    {
      name: '눈찌르기!!!',
      description:
        '플레이어를 지목합니다. 다음 5라운드 동안 그 플레이어는 장르·초성 등 힌트를 볼 수 없습니다.',
      effectType: 'hide_hints',
      effectValue: JSON.stringify({ rounds: 5 }),
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '전환',
      description:
        '선택 즉시 실버 등급 증강 중 하나를 랜덤으로 뽑아 보관합니다. (사용 컷신 없음)',
      effectType: 'tier_upgrade',
      effectValue: JSON.stringify({ higherTiers: ['silver'] }),
      tier: 'bronze',
      imageUrl: '/augments/convert.png',
    },
    {
      name: '한입만',
      description: '사용 시 아직 공개되지 않은 슬롯 1개를 자동으로 맞힌 것으로 처리합니다. (일반 점수 지급)',
      effectType: 'auto_reveal_slot',
      effectValue: '{}',
      tier: 'bronze',
      imageUrl: '/augments/one-bite.jpg',
    },
    {
      name: '잠깐만요',
      description:
        '플레이어 한 명을 선택합니다. 다음 1라운드 동안 그 플레이어는 라운드 시작 5초 뒤에만 정답을 입력할 수 있습니다.',
      effectType: 'answer_delay',
      effectValue: JSON.stringify({ rounds: 1, delaySec: 5 }),
      tier: 'bronze',
      imageUrl: '/augments/wait-a-moment.jpg',
    },
    {
      name: '내친구 진석이',
      description: '사용하면 채팅에 「{nick}님의 친구 중에 진석이가 있답니다!」를 남깁니다.',
      effectType: 'flavor_announce',
      effectValue: JSON.stringify({ message: '{nick}님의 친구 중에 진석이가 있답니다!' }),
      tier: 'bronze',
      imageUrl: '/augments/friend-jinseok.png',
    },
    {
      name: '나이거 뭔지 알아',
      description:
        '지금부터 1라운드 동안 제목과 가수를 알 수 있지만, 정답은 인정되지 않습니다. (채팅은 가능)',
      effectType: 'know_but_cant',
      effectValue: JSON.stringify({ rounds: 1 }),
      tier: 'bronze',
      imageUrl: '/augments/i-know-that.jpg',
    },
    {
      name: '범인은 당신이야!',
      description:
        '플레이어를 지목합니다. 대상에게는 알리지 않고, 다른 사람에게만 감시가 걸렸다고 알려줍니다. 다음 라운드에 그 플레이어가 문제를 맞히면, 맞힌 라운드 기준 다음 라운드에 수면이 걸립니다. (정답 인정 안 됨 · 채팅은 가능 · 못 맞히면 수면 없음)',
      effectType: 'accuse_sleep',
      effectValue: '{}',
      tier: 'bronze',
      imageUrl: '/augments/you-are-the-culprit.jpg',
    },
    {
      name: '엿보기 구멍',
      description: '다음 라운드의 힌트(장르·제목·가수 초성)를 미리 확인합니다.',
      effectType: 'peek_next_hint',
      effectValue: '{}',
      tier: 'bronze',
      imageUrl: null,
    },
    {
      name: '전원을 꺼봤습니다',
      description: '사용 즉시 본인을 제외한 모든 플레이어의 노래가 20초 동안 끊깁니다.',
      effectType: 'power_off_others',
      effectValue: JSON.stringify({ seconds: 20 }),
      tier: 'silver',
      imageUrl: '/augments/turned-off-all.jpg',
    },
    {
      name: '에라모르겠다',
      description:
        '지금부터 1라운드 동안 모든 사람에게 「한로로 강남스타일 리믹스」를 재생합니다.',
      effectType: 'named_decoy_all',
      effectValue: JSON.stringify({
        rounds: 1,
        scoreMult: 1,
        titleIncludes: '한로로',
        songLabel: '한로로 강남스타일 리믹스',
        youtubeUrl: 'https://www.youtube.com/watch?v=9DeJJIJ_S2Y',
        startSec: 74,
      }),
      tier: 'bronze',
      imageUrl: '/augments/whatever.png',
    },
    {
      name: '코로나',
      description:
        '이런 코로나가 이방에 터졌습니다! 격리 해야겠지? 다음 2라운드 동안 채팅방이 두 격리조로 분리되어, 같은 조 채팅만 보입니다. (정답·시스템 알림은 전원 공유)',
      effectType: 'chat_isolate',
      effectValue: JSON.stringify({ rounds: 2 }),
      tier: 'bronze',
      imageUrl: null,
    },
    {
      name: '올인',
      description:
        '다음 1라운드 동안 초성이 즉시 공개됩니다. 하나라도 맞히면 +3점, 전부 못 맞히면 −3점입니다.',
      effectType: 'wager_answer',
      effectValue: JSON.stringify({ rounds: 1, bonus: 3, penalty: 3, nextRound: true, earlyChosung: true }),
      tier: 'silver',
      imageUrl: null,
    },
    {
      name: '셔플',
      description:
        '지금 나오는 곡을 제외한 남은 곡들의 장르별 개수를 평균에 가깝게 맞춥니다. (부족한 장르는 은행에서 보충)',
      effectType: 'equalize_genre_remaining',
      effectValue: '{}',
      tier: 'silver',
      imageUrl: null,
    },
    {
      name: '보너스 타임',
      description: '지금부터 3라운드 동안 본인에게만 초성이 즉시 공개됩니다.',
      effectType: 'early_chosung',
      effectValue: JSON.stringify({ rounds: 3 }),
      tier: 'silver',
      imageUrl: null,
    },
    {
      name: '묻고 더블로가',
      description: '지금부터 2라운드 동안 맞춘 점수를 2배로 얻습니다.',
      effectType: 'score_mult',
      effectValue: JSON.stringify({ rounds: 2, mult: 2 }),
      tier: 'silver',
      imageUrl: '/augments/ask-and-double.jpg',
    },
    {
      name: '세노',
      description:
        '플레이어를 지목해 그 사람에게만 「연애서큘레이션」을 들려줍니다. (다음 1라운드)',
      effectType: 'named_decoy',
      effectValue: JSON.stringify({
        rounds: 1,
        scoreMult: 1,
        titleIncludes: '연애서큘레이션',
        youtubeUrl: 'https://www.youtube.com/watch?v=ERbmOHe789o',
        startSec: 0,
      }),
      tier: 'silver',
      imageUrl: '/augments/seno.jpg',
    },
    {
      name: '기부천사',
      description:
        '랜덤한 다른 플레이어 최대 5명의 점수를 각 1점씩 깎고, 본인은 총 +1점을 얻습니다.',
      effectType: 'donate_from_random',
      effectValue: JSON.stringify({ count: 5, amount: 1, gain: 1 }),
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '밴픽',
      description: '장르를 고르면 그 장르 잔량을 밴하고 다른 장르로 랜덤 배분합니다. (항상 성공)',
      effectType: 'ban_genre',
      effectValue: '{}',
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '가호선택',
      description:
        '선택 시 가호 3장 중 하나를 골라 보관합니다. 리롤 없음 · 이름·사진만(효과는 선택 후 확인). 시간이 끝나면 후보 중 랜덤 배정됩니다.',
      effectType: 'gaho_select',
      effectValue: '{}',
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '가불기',
      description:
        '플레이어에게 가불기를 겁니다. 다음 3라운드 동안 그 플레이어가 정답을 맞히면 −1점, 라운드에서 한 번도 못 맞히면 −2점이며, 깎인 점수는 시전자에게 갑니다.',
      effectType: 'gabuki_mark',
      effectValue: JSON.stringify({ rounds: 3, hitPenalty: 1, missPenalty: 2 }),
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '불꽃남자김상원',
      description:
        '플레이어 한 명을 고릅니다. 다음 라운드부터 3라운드 동안 방 노래와 「불꽃남자」가 같이 들립니다. 평소처럼 +1점을 얻고, 맞힐 때마다 선택한 플레이어는 −1점입니다.',
      effectType: 'flame_kim',
      effectValue: JSON.stringify({
        rounds: 3,
        drain: 1,
        youtubeUrl: 'https://www.youtube.com/watch?v=x1PTr27NYds',
        startSec: 10,
      }),
      tier: 'gold',
      imageUrl: '/augments/fire-sangwon.jpg',
    },
    {
      name: '미래시',
      description:
        '앞으로 나올 5라운드 중 3곡의 제목·가수를 미리 확인합니다. 순서는 랜덤이며, 이번 라운드가 끝나면 사라집니다.',
      effectType: 'future_sight',
      effectValue: JSON.stringify({ lookAhead: 5, pick: 3 }),
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '조커뽑기',
      description: '플레이어를 지목해 그 플레이어가 보유 중인 증강을 가져옵니다.',
      effectType: 'steal_held_augment',
      effectValue: '{}',
      tier: 'gold',
      imageUrl: '/augments/joker-draw.jpg',
    },
    {
      name: '진흙탕 싸움',
      description:
        '다음 1라운드 동안 모든 플레이어에게 노래 대신 BGM이 재생되고 초성만 보입니다. 본인이 정답을 맞히면 +5점입니다.',
      effectType: 'mud_fight',
      effectValue: JSON.stringify({
        rounds: 1,
        bonus: 5,
        bgmUrl: 'https://www.youtube.com/watch?v=ZzHYbM0l4ec',
        bgmStartSec: 0,
      }),
      tier: 'gold',
      imageUrl: '/augments/mudfight.jpg',
    },
    {
      name: '차차차',
      description:
        '자동 사용. 거의 동시에 정답이 나와 중복 처리될 때(약 0.5초), 본인에게 우선권이 있습니다. (5회)',
      effectType: 'cha_cha_cha',
      effectValue: JSON.stringify({ charges: 5, windowMs: 500 }),
      tier: 'gold',
      imageUrl: null,
    },
    {
      name: '전환',
      description:
        '선택 즉시 골드 등급 증강 중 하나를 랜덤으로 뽑아 보관합니다. (사용 컷신 없음)',
      effectType: 'tier_upgrade',
      effectValue: JSON.stringify({ higherTiers: ['gold'] }),
      tier: 'silver',
      imageUrl: '/augments/convert.png',
    },
    {
      name: '삼연 보너스',
      description: '지금부터 3라운드 동안 문제를 맞히면 1점을 추가로 얻습니다.',
      effectType: 'score_bonus',
      effectValue: JSON.stringify({ rounds: 3, bonus: 1 }),
      tier: 'silver',
      imageUrl: null,
    },
    {
      name: '다요',
      description:
        '플레이어를 지목합니다. 다음 2라운드 동안 그 플레이어는 답 끝에 「다요」를 붙여야 정답으로 인정됩니다.',
      effectType: 'polite_suffix',
      effectValue: JSON.stringify({ rounds: 2, suffix: '다요' }),
      tier: 'silver',
      imageUrl: '/augments/dayo.jpg',
    },
    {
      name: '진조이니라',
      description:
        '지금부터 3라운드 동안 답 끝에 「이니라」를 붙여야 정답으로 인정됩니다. 맞히면 +1점을 추가로 얻습니다.',
      effectType: 'self_suffix_bonus',
      effectValue: JSON.stringify({ rounds: 3, suffix: '이니라', bonus: 1 }),
      tier: 'silver',
      imageUrl: '/augments/jinjo-inira.png',
    },
    {
      name: '영역전개',
      description:
        '플레이어를 지목하지 않습니다. 다음 라운드부터 3라운드 동안 매 라운드 시작 시 본인보다 점수가 높은 플레이어는 10초간 정답이 인정되지 않습니다. (채팅은 가능 · 본인은 정상)',
      effectType: 'answer_block_others',
      effectValue: JSON.stringify({ rounds: 3, blockMs: 10000 }),
      tier: 'silver',
      imageUrl: '/augments/domain-expansion.png',
    },
  ]
  for (const a of augments) {
    await prisma.augment.create({
      data: {
        name: a.name,
        description: a.description,
        effectType: a.effectType,
        effectValue: a.effectValue,
        tier: a.tier,
        imageUrl: a.imageUrl,
        enabled: true,
      },
    })
  }

  console.log(`Seed OK — admin/admin1234 , test/test1234 · augments ${augments.length}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
