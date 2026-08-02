import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { GameProvider } from './GameContext'
import { installSfxUnlock } from './sfx'
import './index.css'

installSfxUnlock()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GameProvider>
      <App />
    </GameProvider>
  </React.StrictMode>,
)
