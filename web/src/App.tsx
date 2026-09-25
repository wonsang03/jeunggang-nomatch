import { useState, useEffect, useCallback } from 'react'
import { useGame } from './GameContext'
import { FlameKimOverlayBgm, PeckSongBgm, RoomSongPersistentBgm } from './youtubePlayer'
import { HomeScreen, LoginScreen } from './screens/AuthScreens'
import { BankScreen } from './screens/BankScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import type { Screen } from './screens/types'
import { Btn, C, crumpledPaper, CrumpleOverlay, F, PencilFilters, sk } from './ui'
import { AugmentUseNotice } from './components/AugmentUseNotice'
import { GahoCutscene } from './components/GahoCutscene'
import { LobbyScreen } from './screens/LobbyScreen'
import { WaitingScreen } from './screens/WaitingScreen'
import { GameScreen } from './screens/GameScreen'
import { AugmentScreen } from './screens/AugmentScreen'
import { ResultScreen } from './screens/ResultScreen'

export default function App() {
  const {
    user,
    room,
    results,
    trumanReveal,
    clearTrumanReveal,
    gahoCutscene,
    clearGahoCutscene,
    augmentNotice,
    clearAugmentNotice,
  } = useGame()
  const [screen, setScreen] = useState<Screen>('home')
  const [manual, setManual] = useState(false)

  useEffect(() => {
    if (manual) return
    if (!user) { setScreen(s => (s === 'login' ? s : 'home')); return }
    if (results || room?.status === 'ended') { setScreen('result'); return }
    if (!room) { setScreen(s => (s === 'bank' || s === 'profile' ? s : 'lobby')); return }
    if (room.status === 'lobby') setScreen('waiting')
    else if (room.status === 'playing' || room.status === 'revealing' || room.status === 'countdown' || room.status === 'duel') setScreen('game')
    else if (room.status === 'augment') setScreen('augment')
  }, [user, room, results, manual])

  // identity가 흔들리면 nav를 deps로 쓰는 화면 effect들이 매 렌더 재실행된다
  const nav = useCallback((s: Screen) => {
    setManual(true)
    setScreen(s)
    setTimeout(() => setManual(false), 50)
  }, [])

  const render = () => {
    switch (screen) {
      case 'home':    return <HomeScreen    nav={nav} />
      case 'login':   return <LoginScreen   nav={nav} />
      case 'lobby':   return <LobbyScreen   nav={nav} />
      case 'waiting': return <WaitingScreen nav={nav} />
      case 'game':    return <GameScreen    nav={nav} />
      case 'augment': return <AugmentScreen nav={nav} />
      case 'result':  return <ResultScreen  nav={nav} />
      case 'bank':    return <BankScreen    nav={nav} />
      case 'profile': return <ProfileScreen nav={nav} />
    }
  }

  return (
    <>
      <PencilFilters />
      <div style={{ position: 'fixed', inset: 0, ...crumpledPaper, zIndex: 0 }}>
        <CrumpleOverlay />
      </div>
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh' }}>
        {render()}
      </div>
      <FlameKimOverlayBgm />
      <PeckSongBgm />
      <RoomSongPersistentBgm />
      {gahoCutscene && (
        <GahoCutscene
          key={`gaho-${gahoCutscene.nickname}-${gahoCutscene.name}`}
          item={gahoCutscene}
          onDone={clearGahoCutscene}
        />
      )}
      {augmentNotice && !gahoCutscene && (
        <AugmentUseNotice
          key={`${augmentNotice.nickname}-${augmentNotice.name}-${augmentNotice.message}`}
          name={augmentNotice.name}
          message={augmentNotice.message}
          onClose={clearAugmentNotice}
        />
      )}
      {trumanReveal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            backgroundColor: 'rgba(30,40,50,0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={clearTrumanReveal}
        >
          <div
            style={{
              ...sk(),
              backgroundColor: C.card,
              padding: '36px 28px',
              maxWidth: 420,
              width: '100%',
              textAlign: 'center',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontFamily: F.brand, fontSize: 36, fontWeight: 700, marginBottom: 10 }}>
              짜잔!
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 20, fontWeight: 800, color: C.blue, marginBottom: 12 }}>
              당신은 트루먼이었습니다
            </div>
            <div style={{ fontFamily: F.ui, fontSize: 16, color: C.body, lineHeight: 1.5, marginBottom: 18 }}>
              {trumanReveal.fakeScore > 0 ? (
                <>
                  가짜 +{trumanReveal.fakeScore}점은 무효입니다.
                  <br />
                  실제 점수 {trumanReveal.realScore}점
                </>
              ) : (
                <>실제 점수 {trumanReveal.realScore}점</>
              )}
            </div>
            <Btn onClick={clearTrumanReveal}>확인</Btn>
          </div>
        </div>
      )}
    </>
  )
}
