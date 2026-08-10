import { useState, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import type { CardRank } from '../types'
import { Camera, Check, RefreshCw, Loader, AlertCircle, X, ThumbsDown, ThumbsUp, Send } from 'lucide-react'
import { saveScanFeedback } from '../firebase/db'

interface CardPickerProps {
  playerName: string
  onConfirm: (score: number, cards: { rank: CardRank; count: number }[]) => void
  onCancel: () => void
}

// ── Scoring map ───────────────────────────────────────────────────────────────

const CARD_POINTS: Record<string, number> = {
  'A': 11, 'ACE': 11,
  'K': 10, 'KING': 10,
  'Q': 10, 'QUEEN': 10,
  'J': 10, 'JACK': 10,
  '10': 10, '9': 9, '8': 8, '7': 7,
  '6': 6,  '5': 5, '4': 4, '3': 3, '2': 2,
  'JOKER': 25, 'JKR': 25,
}

// Friendly display names
const TOKEN_LABEL: Record<string, string> = {
  'A': 'Ace', 'ACE': 'Ace',
  'K': 'King', 'KING': 'King',
  'Q': 'Queen', 'QUEEN': 'Queen',
  'J': 'Jack', 'JACK': 'Jack',
  'JOKER': 'Joker', 'JKR': 'Joker',
}

export interface DetectedToken {
  token: string   // canonical key, e.g. "A", "10", "JOKER"
  label: string   // display, e.g. "Ace", "10", "Joker"
  points: number
  count: number   // number of cards detected
}

function parseDetection(annotations: { description: string }[]): {
  tokens: DetectedToken[]
  score: number
} {
  const fragments = annotations.slice(1).map(a => a.description.trim().toUpperCase())
  const tally: Record<string, number> = {}
  for (const f of fragments) {
    if (CARD_POINTS[f] !== undefined) tally[f] = (tally[f] ?? 0) + 1
  }

  // Vision returns each corner label twice per card (top-left + bottom-right)
  // so raw count ÷ 2 ≈ number of physical cards
  const tokens: DetectedToken[] = Object.entries(tally).map(([token, raw]) => {
    const count = Math.max(1, Math.round(raw / 2))
    return {
      token,
      label: TOKEN_LABEL[token] ?? token,
      points: CARD_POINTS[token],
      count,
    }
  })

  const score = tokens.reduce((sum, t) => sum + t.points * t.count, 0)
  return { tokens, score }
}

// ── Google Cloud Vision ───────────────────────────────────────────────────────

const VISION_API_KEY = import.meta.env.VITE_FIREBASE_API_KEY

async function analyseImage(base64: string): Promise<{
  tokens: DetectedToken[]
  score: number
  error?: string
}> {
  const body = {
    requests: [{
      image: { content: base64 },
      features: [{ type: 'TEXT_DETECTION', maxResults: 100 }],
    }],
  }
  const resp = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )
  const data = await resp.json()
  if (!resp.ok) return { tokens: [], score: 0, error: data?.error?.message ?? `HTTP ${resp.status}` }
  const response = data.responses?.[0]
  if (response?.error) return { tokens: [], score: 0, error: response.error.message }
  const annotations: { description: string }[] = response?.textAnnotations ?? []
  if (annotations.length === 0) return { tokens: [], score: 0, error: 'No text detected. Enter score manually.' }
  return parseDetection(annotations)
}

function compressImage(dataUrl: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const MAX = 1024
      const scale = img.width > MAX ? MAX / img.width : 1
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.6))
    }
    img.src = dataUrl
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CardPicker({ playerName, onConfirm, onCancel }: CardPickerProps) {
  // Try to get gameId from route params (may be undefined outside game route)
  const params = useParams<{ gameId?: string }>()
  const gameId = params.gameId ?? null

  const [points, setPoints]                   = useState('')
  const [capturedImage, setCapturedImage]     = useState<string | null>(null)
  const [compressedB64, setCompressedB64]     = useState<string | null>(null)   // for feedback
  const [analyzing, setAnalyzing]             = useState(false)
  const [aiError, setAiError]                 = useState('')
  const [detectedTokens, setDetectedTokens]   = useState<DetectedToken[]>([])
  const [aiScore, setAiScore]                 = useState<number | null>(null)
  const [cameraOpen, setCameraOpen]           = useState(false)
  const [stream, setStream]                   = useState<MediaStream | null>(null)

  // Feedback state
  const [feedbackState, setFeedbackState]     = useState<'idle' | 'sending' | 'sent'>('idle')
  const [feedbackError, setFeedbackError]     = useState('')

  const videoRef     = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const score      = parseInt(points, 10)
  const validScore = !isNaN(score) && score >= 0

  // User changed the score away from AI suggestion → offer feedback
  const scoreWasEdited = aiScore !== null && validScore && score !== aiScore

  // ── Camera ──────────────────────────────────────────────────────────────────

  const openCamera = useCallback(async () => {
    setAiError('')
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      setStream(s)
      setCameraOpen(true)
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s }, 100)
    } catch {
      setAiError('Camera not accessible. Use Gallery instead.')
    }
  }, [])

  const closeCamera = useCallback(() => {
    stream?.getTracks().forEach(t => t.stop())
    setStream(null)
    setCameraOpen(false)
  }, [stream])

  const capturePhoto = useCallback(() => {
    if (!videoRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width  = videoRef.current.videoWidth  || 1280
    canvas.height = videoRef.current.videoHeight || 720
    canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0)
    closeCamera()
    runAI(canvas.toDataURL('image/jpeg', 0.9))
  }, [closeCamera])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => runAI(ev.target?.result as string)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const runAI = async (dataUrl: string) => {
    setCapturedImage(dataUrl)
    setAnalyzing(true)
    setAiError('')
    setPoints('')
    setDetectedTokens([])
    setAiScore(null)
    setFeedbackState('idle')
    setFeedbackError('')
    try {
      const compressed = await compressImage(dataUrl)
      const b64 = compressed.split(',')[1]
      setCompressedB64(b64)
      const { tokens, score: detected, error } = await analyseImage(b64)
      setDetectedTokens(tokens)
      if (error) {
        setAiError(error)
      } else if (!detected && tokens.length === 0) {
        setAiError('No cards found. Enter score manually.')
      } else {
        setAiScore(detected)
        setPoints(String(detected))
      }
    } catch (err: unknown) {
      setAiError(err instanceof Error ? err.message : 'Detection failed.')
    } finally {
      setAnalyzing(false)
    }
  }

  const reset = () => {
    setCapturedImage(null)
    setCompressedB64(null)
    setAiError('')
    setPoints('')
    setDetectedTokens([])
    setAiScore(null)
    setFeedbackState('idle')
    setFeedbackError('')
  }

  const handleConfirm = () => { if (validScore) onConfirm(score, []) }

  // ── Feedback submission ──────────────────────────────────────────────────────

  const handleSendFeedback = async () => {
    if (!compressedB64 || aiScore === null || !validScore) return
    setFeedbackState('sending')
    setFeedbackError('')
    try {
      await saveScanFeedback({
        imageBase64: compressedB64,
        detectedTokens,
        aiScore,
        correctedScore: score,
        playerName,
        gameId,
      })
      setFeedbackState('sent')
    } catch (e: unknown) {
      setFeedbackError('Could not save feedback. Try again.')
      setFeedbackState('idle')
      console.error(e)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 pt-safe pt-4 pb-3 border-b border-gray-100 bg-white">
        <div>
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-wide">Remaining cards</p>
          <h2 className="text-lg font-bold text-gray-900 leading-tight">{playerName}</h2>
        </div>
        <button
          onClick={onCancel}
          className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 active:bg-gray-200"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Score + Confirm row ── */}
      <div className="flex-shrink-0 px-5 py-4 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={points}
            onChange={e => { setPoints(e.target.value); setFeedbackState('idle'); setFeedbackError('') }}
            placeholder="0"
            className="flex-1 text-4xl font-bold text-brand-700 text-center py-3 rounded-2xl border-2 border-gray-200 focus:border-brand-500 focus:outline-none bg-white"
          />
          <button
            onClick={handleConfirm}
            disabled={!validScore}
            className="flex-shrink-0 w-24 h-16 rounded-2xl bg-brand-600 text-white font-bold text-sm flex flex-col items-center justify-center gap-0.5 disabled:opacity-40 active:bg-brand-700 transition-colors"
          >
            <Check size={20} />
            <span>Confirm</span>
          </button>
        </div>
        {validScore && (
          <p className="text-center text-sm text-gray-500 mt-2">{score} points for {playerName}</p>
        )}
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

        <p className="text-sm font-semibold text-gray-700">Or scan cards with camera</p>

        {/* Analyzing spinner */}
        {analyzing && (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-brand-600 bg-brand-50 rounded-2xl">
            <Loader size={28} className="animate-spin" />
            <span className="text-sm font-medium">Detecting cards…</span>
          </div>
        )}

        {/* Post-analysis: image + detection breakdown */}
        {!analyzing && capturedImage && (
          <div className="space-y-3">

            {/* Photo preview */}
            <div className="relative rounded-2xl overflow-hidden border border-gray-200">
              <img src={capturedImage} alt="Captured" className="w-full max-h-52 object-cover" />
              {validScore && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 py-2 text-center">
                  <span className="text-white text-2xl font-bold">{score} pts</span>
                </div>
              )}
            </div>

            {/* Detection breakdown */}
            {detectedTokens.length > 0 && (
              <div className="bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                    AI detected — {detectedTokens.length} card type{detectedTokens.length !== 1 ? 's' : ''}
                  </span>
                  <span className="text-xs text-brand-700 font-bold">= {aiScore} pts</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {detectedTokens.map(t => (
                    <div key={t.token} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        {/* Card chip */}
                        <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-white border-2 border-gray-300 font-bold text-sm text-gray-800 shadow-sm">
                          {t.token === 'JOKER' || t.token === 'JKR' ? '🃏' : t.token}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-gray-800">{t.label}</p>
                          <p className="text-xs text-gray-400">{t.count} card{t.count !== 1 ? 's' : ''} × {t.points} pts</p>
                        </div>
                      </div>
                      <span className="text-sm font-bold text-brand-700">{t.points * t.count}</span>
                    </div>
                  ))}
                </div>
                {/* Total row */}
                <div className="px-4 py-2.5 bg-brand-50 border-t border-brand-100 flex items-center justify-between">
                  <span className="text-sm font-semibold text-brand-700">AI Total</span>
                  <span className="text-sm font-bold text-brand-700">{aiScore} pts</span>
                </div>
              </div>
            )}

            {/* AI error (no cards found) */}
            {aiError && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-sm text-amber-700">
                <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                <span>{aiError}</span>
              </div>
            )}

            {/* Feedback panel — shown when user has changed the score */}
            {scoreWasEdited && feedbackState !== 'sent' && (
              <div className="bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3 space-y-2.5">
                <div className="flex items-start gap-2">
                  <ThumbsDown size={15} className="text-blue-500 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-blue-800">
                    <p className="font-semibold">AI got it wrong?</p>
                    <p className="text-xs text-blue-600 mt-0.5">
                      AI detected <strong>{aiScore} pts</strong>, you corrected to <strong>{score} pts</strong>.
                      {' '}Submit feedback so the detection improves over time.
                    </p>
                  </div>
                </div>
                {feedbackError && (
                  <p className="text-xs text-red-600">{feedbackError}</p>
                )}
                <button
                  onClick={handleSendFeedback}
                  disabled={feedbackState === 'sending'}
                  className="btn-primary w-full py-2.5 text-sm gap-2"
                >
                  {feedbackState === 'sending'
                    ? <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                    : <><Send size={14} /> Submit feedback</>
                  }
                </button>
              </div>
            )}

            {/* Feedback sent confirmation */}
            {feedbackState === 'sent' && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 text-sm text-green-700">
                <ThumbsUp size={15} className="flex-shrink-0" />
                <span>Feedback saved — thank you! 🙏</span>
              </div>
            )}

            <button onClick={reset} className="btn-secondary w-full gap-2">
              <RefreshCw size={14} /> Retake / clear
            </button>
          </div>
        )}

        {/* Camera / gallery buttons */}
        {!analyzing && !capturedImage && (
          <div className="space-y-3">
            {cameraOpen ? (
              <div className="relative rounded-2xl overflow-hidden bg-black">
                <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-56 object-cover" />
                <p className="absolute top-2 left-0 right-0 text-center text-xs text-white/80 bg-black/30 py-1">
                  Spread cards face-up · good lighting
                </p>
                <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                  <button
                    onClick={capturePhoto}
                    className="w-16 h-16 rounded-full bg-white shadow-xl flex items-center justify-center active:scale-90 transition-transform"
                  >
                    <div className="w-11 h-11 rounded-full bg-brand-600" />
                  </button>
                </div>
                <button
                  onClick={closeCamera}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center font-bold text-lg"
                >×</button>
              </div>
            ) : (
              <div className="flex gap-3">
                <button onClick={openCamera} className="btn-secondary flex-1 py-4 gap-2 flex-col h-auto">
                  <Camera size={22} />
                  <span className="text-xs">Camera</span>
                </button>
                <button onClick={() => fileInputRef.current?.click()} className="btn-secondary flex-1 py-4 gap-2 flex-col h-auto">
                  <Camera size={22} />
                  <span className="text-xs">Gallery</span>
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
              </div>
            )}

            {aiError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-600">
                <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                <span>{aiError}</span>
              </div>
            )}
          </div>
        )}

        <div className="h-8" />
      </div>
    </div>
  )
}
