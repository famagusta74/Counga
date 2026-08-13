import { useState, useRef, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import type { CardRank } from '../types'
import { Camera, Check, RefreshCw, Loader, AlertCircle, X, ImageIcon, Star, Plus, Minus } from 'lucide-react'
import { saveScanFeedback } from '../firebase/db'

interface CardPickerProps {
  playerName: string
  /** Already-confirmed winner uid for this round (only one allowed) */
  roundWinnerUid: string | null
  onConfirm: (score: number, cards: { rank: CardRank; count: number }[]) => void
  /** Called when user marks THIS player as the round winner (score = 0) */
  onWinner: () => void
  onCancel: () => void
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/** Max physical cards of the same rank a single player can hold */
const MAX_PER_RANK = 2

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

const TOKEN_LABEL: Record<string, string> = {
  'A': 'Ace', 'ACE': 'Ace',
  'K': 'King', 'KING': 'King',
  'Q': 'Queen', 'QUEEN': 'Queen',
  'J': 'Jack', 'JACK': 'Jack',
  'JOKER': 'Joker', 'JKR': 'Joker',
}

export interface DetectedToken {
  token: string
  label: string
  points: number
  count: number
}

// ── Card grid definition ──────────────────────────────────────────────────────
// Ordered by points descending for quick entry

const CARD_GRID: { token: string; label: string; pts: number; display: string }[] = [
  { token: 'JOKER', label: 'Joker', pts: 25, display: '🃏' },
  { token: 'A',     label: 'Ace',   pts: 11, display: 'A'  },
  { token: 'K',     label: 'King',  pts: 10, display: 'K'  },
  { token: 'Q',     label: 'Queen', pts: 10, display: 'Q'  },
  { token: 'J',     label: 'Jack',  pts: 10, display: 'J'  },
  { token: '10',    label: '10',    pts: 10, display: '10' },
  { token: '9',     label: '9',     pts: 9,  display: '9'  },
  { token: '8',     label: '8',     pts: 8,  display: '8'  },
  { token: '7',     label: '7',     pts: 7,  display: '7'  },
  { token: '6',     label: '6',     pts: 6,  display: '6'  },
  { token: '5',     label: '5',     pts: 5,  display: '5'  },
  { token: '4',     label: '4',     pts: 4,  display: '4'  },
  { token: '3',     label: '3',     pts: 3,  display: '3'  },
  { token: '2',     label: '2',     pts: 2,  display: '2'  },
]

// ── Vision detection helpers ──────────────────────────────────────────────────

/**
 * Rank normaliser — maps every textual form Vision might return to our canonical token.
 * Handles: "A", "ACE", "K", "KING", "Q♥", "10♠", "JOKER", "JKR", "J0KER", etc.
 */
function normaliseRank(raw: string): string | null {
  const s = raw.toUpperCase().trim()

  // Strip suit symbols, trailing suit letters, and any non-alphanumeric characters
  // (Vision sometimes produces unicode box chars like □ ☐ ם glued to rank letters)
  const stripped = s
    .replace(/[♠♥♦♣SHDC]/g, '')
    .replace(/[^A-Z0-9]/g, '')   // remove all remaining non-alphanumeric noise
    .trim()

  if (!stripped) return null

  if (stripped === 'JOKER' || stripped === 'JKR' || stripped === 'J0KER' || stripped === 'JOKR') return 'JOKER'
  if (stripped === 'A' || stripped === 'ACE') return 'A'
  if (stripped === 'K' || stripped === 'KING') return 'K'
  if (stripped === 'Q' || stripped === 'QUEEN') return 'Q'
  // "J" might be confused with "1" in some fonts — guard against "I"
  if (stripped === 'J' || stripped === 'JACK' || stripped === 'JAC') return 'J'
  if (stripped === '10' || stripped === '1O' || stripped === 'IO') return '10'
  if (stripped === '9') return '9'
  if (stripped === '8') return '8'
  if (stripped === '7') return '7'
  if (stripped === '6') return '6'
  if (stripped === '5') return '5'
  if (stripped === '4') return '4'
  if (stripped === '3') return '3'
  if (stripped === '2') return '2'

  return null
}

/**
 * Parse the raw Vision fullTextAnnotation string.
 * Strategy:
 *  1. Split the full text into whitespace-separated tokens
 *  2. Also run a regex to pick out rank+suit combos like "Q♥", "10♠", "K♦"
 *  3. Normalise each candidate, strip unicode noise, and tally occurrences
 *  4. Cap each rank at MAX_PER_RANK (2) — the old ÷2 heuristic misfired when
 *     Vision sees centre-of-card text, producing 3× hits for some ranks.
 *     Capping directly is more robust and simpler.
 */
function parseFullText(fullText: string): {
  tokens: DetectedToken[]
  score: number
  rawFragments: string[]
} {
  // Collect every candidate token (whitespace-split)
  const rawTokens = fullText
    .replace(/\n/g, ' ')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean)

  // Also extract rank+suit combos as a unit (e.g. "Q♥", "10♠", "K□" → normalised)
  const combos = Array.from(fullText.matchAll(/([2-9]|10|[AKQJ]|JOKER|JKR)[♠♥♦♣SHDC\W]?/gi))
    .map(m => m[0])

  const allCandidates = [...rawTokens, ...combos]

  // Only keep tokens that actually contain at least one alphanumeric character
  // (filters noise like pure suit symbols or box characters)
  const cleanCandidates = allCandidates.filter(c => /[A-Za-z0-9]/.test(c))
  const rawFragments = [...new Set(cleanCandidates)]

  const tally: Record<string, number> = {}
  for (const cand of cleanCandidates) {
    const rank = normaliseRank(cand)
    if (rank) tally[rank] = (tally[rank] ?? 0) + 1
  }

  // Cap at MAX_PER_RANK instead of ÷2 — safer when Vision reads centre text too
  const tokens: DetectedToken[] = Object.entries(tally)
    .map(([token, hits]) => {
      const count = Math.min(hits, MAX_PER_RANK)
      return { token, label: TOKEN_LABEL[token] ?? token, points: CARD_POINTS[token] ?? 0, count }
    })
    .filter(t => t.points > 0)

  const score = tokens.reduce((sum, t) => sum + t.points * t.count, 0)
  return { tokens, score, rawFragments }
}

/**
 * Parse individual word annotations (TEXT_DETECTION fallback path).
 * Used when DOCUMENT_TEXT_DETECTION fullTextAnnotation is absent.
 */
function parseWordAnnotations(annotations: { description: string }[]): {
  tokens: DetectedToken[]
  score: number
  rawFragments: string[]
} {
  // annotations[0] is the full concatenated block — use it for the regex scan
  const fullText = annotations[0]?.description ?? ''
  if (fullText) return parseFullText(fullText)

  // Last resort: scan individual annotation words
  const rawFragments = annotations.slice(1).map(a => a.description.trim()).filter(Boolean)
  const tally: Record<string, number> = {}
  for (const f of rawFragments) {
    const rank = normaliseRank(f)
    if (rank) tally[rank] = (tally[rank] ?? 0) + 1
  }
  const tokens: DetectedToken[] = Object.entries(tally).map(([token, hits]) => {
    const count = Math.min(hits, MAX_PER_RANK)
    return { token, label: TOKEN_LABEL[token] ?? token, points: CARD_POINTS[token] ?? 0, count }
  }).filter(t => t.points > 0)
  const score = tokens.reduce((sum, t) => sum + t.points * t.count, 0)
  return { tokens, score, rawFragments }
}

// ── Google Cloud Vision ───────────────────────────────────────────────────────

const VISION_API_KEY = import.meta.env.VITE_FIREBASE_API_KEY

async function analyseImage(base64: string): Promise<{
  tokens: DetectedToken[]
  score: number
  rawFragments: string[]
  error?: string
}> {
  const body = {
    requests: [{
      image: { content: base64 },
      features: [
        // DOCUMENT_TEXT_DETECTION is better for sparse isolated glyphs (card corners)
        { type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 },
        // OBJECT_LOCALIZATION lets us count "playing card" objects as a secondary signal
        { type: 'OBJECT_LOCALIZATION', maxResults: 20 },
      ],
    }],
  }
  const resp = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${VISION_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )
  const data = await resp.json()
  if (!resp.ok) return { tokens: [], score: 0, rawFragments: [], error: data?.error?.message ?? `HTTP ${resp.status}` }
  const response = data.responses?.[0]
  if (response?.error) return { tokens: [], score: 0, rawFragments: [], error: response.error.message }

  // ── Primary: DOCUMENT_TEXT_DETECTION fullTextAnnotation ──────────────────────
  const fullText: string = response?.fullTextAnnotation?.text ?? ''
  if (fullText.trim()) {
    const result = parseFullText(fullText)
    if (result.tokens.length > 0) return result
    // fullText existed but no cards matched — fall through to word annotations
    return { ...result, error: result.rawFragments.length > 0 ? undefined : 'No card text found. Check lighting and card spread.' }
  }

  // ── Fallback: textAnnotations word-by-word ────────────────────────────────────
  const annotations: { description: string }[] = response?.textAnnotations ?? []
  if (annotations.length > 0) {
    const result = parseWordAnnotations(annotations)
    if (result.tokens.length > 0) return result
    return { ...result, error: 'Cards visible but ranks not recognised. Check lighting and try again.' }
  }

  return { tokens: [], score: 0, rawFragments: [], error: 'No text detected. Spread cards face-up in good light and try again.' }
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

export default function CardPicker({ playerName, roundWinnerUid, onConfirm, onWinner, onCancel }: CardPickerProps) {
  const params = useParams<{ gameId?: string }>()
  const gameId = params.gameId ?? null

  const [phase, setPhase]                   = useState<'shoot' | 'review'>('shoot')
  const [capturedImage, setCapturedImage]   = useState<string | null>(null)
  const [compressedB64, setCompressedB64]   = useState<string | null>(null)
  const [analyzing, setAnalyzing]           = useState(false)
  const [aiError, setAiError]               = useState('')
  // editableTokens mirrors detectedTokens but user can adjust counts
  const [editableTokens, setEditableTokens] = useState<DetectedToken[]>([])
  const [rawFragments, setRawFragments]     = useState<string[]>([])
  const [showRaw, setShowRaw]               = useState(false)
  const [aiScore, setAiScore]               = useState<number | null>(null)
  const [points, setPoints]                 = useState('')
  const [saving, setSaving]                 = useState(false)
  const [validationError, setValidationError] = useState('')

  const [cameraOpen, setCameraOpen]         = useState(false)
  const [stream, setStream]                 = useState<MediaStream | null>(null)

  const videoRef     = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const score      = parseInt(points, 10)
  const validScore = !isNaN(score) && score >= 0

  // ── Computed total from card grid ─────────────────────────────────────────────
  const tokenTotal = editableTokens.reduce((s, t) => s + t.points * t.count, 0)

  // ── Card grid helpers ─────────────────────────────────────────────────────────

  /** Tap a card rank button to add 1 of that card to the hand */
  const addCardFromGrid = (token: string, pts: number, label: string) => {
    setValidationError('')
    setEditableTokens(prev => {
      const existing = prev.find(t => t.token === token)
      const currentCount = existing?.count ?? 0
      if (currentCount >= MAX_PER_RANK) {
        setValidationError(`Max ${MAX_PER_RANK} cards of the same rank per player.`)
        return prev
      }
      let next: DetectedToken[]
      if (existing) {
        next = prev.map(t => t.token === token ? { ...t, count: t.count + 1 } : t)
      } else {
        next = [...prev, { token, label, points: pts, count: 1 }]
      }
      const newTotal = next.reduce((s, t) => s + t.points * t.count, 0)
      setPoints(String(newTotal))
      return next
    })
  }

  // ── Token count editing ───────────────────────────────────────────────────────

  const adjustCount = (token: string, delta: number) => {
    setValidationError('')
    setEditableTokens(prev => {
      const current = prev.find(t => t.token === token)
      const newCount = Math.max(0, (current?.count ?? 0) + delta)
      if (newCount > MAX_PER_RANK) {
        setValidationError(
          `Max ${MAX_PER_RANK} cards of the same rank per player (e.g. only 2 Aces, 2 Jokers).`
        )
        return prev  // reject the change
      }
      const next = prev.map(t =>
        t.token === token ? { ...t, count: newCount } : t
      ).filter(t => t.count > 0)
      const newScore = next.reduce((s, t) => s + t.points * t.count, 0)
      setPoints(String(newScore))
      return next
    })
  }

  /** Validate the current editableTokens against game rules. Returns error string or '' */
  const validateTokens = (): string => {
    for (const t of editableTokens) {
      if (t.count > MAX_PER_RANK) {
        return `Too many ${t.label}s: you entered ${t.count}, but max is ${MAX_PER_RANK} per rank per player.`
      }
    }
    return ''
  }

  // ── Camera helpers ────────────────────────────────────────────────────────────

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

  // ── AI flow ───────────────────────────────────────────────────────────────────

  const runAI = async (dataUrl: string) => {
    setCapturedImage(dataUrl)
    setAnalyzing(true)
    setAiError('')
    setPoints('')
    setEditableTokens([])
    setRawFragments([])
    setShowRaw(false)
    setAiScore(null)
    setPhase('review')

    try {
      const compressed = await compressImage(dataUrl)
      const b64 = compressed.split(',')[1]
      setCompressedB64(b64)

      // Save image immediately for training
      saveScanFeedback({
        imageBase64: b64, detectedTokens: [], aiScore: 0, playerName, gameId,
      }).catch(err => console.warn('Image save failed:', err))

      const { tokens, score: detected, rawFragments: frags, error } = await analyseImage(b64)
      setEditableTokens(tokens)
      setRawFragments(frags)

      if (error) {
        setAiError(error)
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

  const retake = () => {
    setCapturedImage(null); setCompressedB64(null); setAiError(''); setPoints('')
    setEditableTokens([]); setRawFragments([]); setShowRaw(false); setAiScore(null)
    setValidationError('')
    setPhase('shoot')
  }

  // ── Save score ────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!validScore) return
    // Validate token counts
    const err = validateTokens()
    if (err) { setValidationError(err); return }
    setValidationError('')
    setSaving(true)
    try {
      if (compressedB64 && aiScore !== null && score !== aiScore) {
        saveScanFeedback({
          imageBase64: compressedB64, detectedTokens: editableTokens,
          aiScore, correctedScore: score, playerName, gameId,
        }).catch(err => console.warn('Feedback save failed:', err))
      }
      onConfirm(score, [])
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">

      {/* ── Top bar ── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 pt-safe pt-3 pb-3 border-b border-gray-100 bg-white">
        <div>
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-wide">Remaining cards</p>
          <h2 className="text-lg font-bold text-gray-900 leading-tight">{playerName}</h2>
        </div>
        <button onClick={onCancel} className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 active:bg-gray-200">
          <X size={18} />
        </button>
      </div>

      {/* ── "Won this round" banner — always visible, disabled if another player already won ── */}
      {roundWinnerUid === null ? (
        <div className="flex-shrink-0 px-4 py-2 bg-amber-50 border-b border-amber-100">
          <button
            onClick={onWinner}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-500 active:bg-amber-600 text-white font-bold text-sm transition-colors"
          >
            <Star size={16} fill="currentColor" />
            {playerName} won this round — 0 pts
          </button>
        </div>
      ) : (
        <div className="flex-shrink-0 px-4 py-2 bg-gray-50 border-b border-gray-100">
          <p className="text-center text-xs text-gray-400">Round winner already set — enter remaining cards below</p>
        </div>
      )}

      {/* ── SHOOT phase ── */}
      {phase === 'shoot' && (
        <div className="flex-1 flex flex-col overflow-y-auto">
          <div className="px-4 pt-4 pb-2 space-y-4">

            {/* Camera / Gallery buttons */}
            {!cameraOpen ? (
              <div className="flex gap-3">
                <button onClick={openCamera} className="btn-secondary flex-1 py-4 gap-2 flex-col h-auto">
                  <Camera size={22} /><span className="text-xs font-medium">Scan with Camera</span>
                </button>
                <button onClick={() => fileInputRef.current?.click()} className="btn-secondary flex-1 py-4 gap-2 flex-col h-auto">
                  <ImageIcon size={22} /><span className="text-xs font-medium">Pick from Gallery</span>
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
              </div>
            ) : (
              <div className="relative rounded-2xl overflow-hidden bg-black flex-shrink-0">
                <video ref={videoRef} autoPlay playsInline muted className="w-full max-h-64 object-cover" />
                <p className="absolute top-2 left-0 right-0 text-center text-xs text-white/80 bg-black/30 py-1">
                  Spread cards face-up · good lighting
                </p>
                <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                  <button onClick={capturePhoto} className="w-16 h-16 rounded-full bg-white shadow-xl flex items-center justify-center active:scale-90 transition-transform">
                    <div className="w-11 h-11 rounded-full bg-brand-600" />
                  </button>
                </div>
                <button onClick={closeCamera} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center font-bold text-lg">×</button>
              </div>
            )}

            {aiError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-600">
                <AlertCircle size={15} className="mt-0.5 flex-shrink-0" /><span>{aiError}</span>
              </div>
            )}

            {/* ── Tap-to-add card grid ── */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tap to add cards</p>
                {editableTokens.length > 0 && (
                  <button
                    onClick={() => { setEditableTokens([]); setPoints('0'); setValidationError('') }}
                    className="text-xs text-red-500 font-medium active:opacity-70"
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {CARD_GRID.map(card => {
                  const currentCount = editableTokens.find(t => t.token === card.token)?.count ?? 0
                  const atMax = currentCount >= MAX_PER_RANK
                  return (
                    <button
                      key={card.token}
                      onClick={() => addCardFromGrid(card.token, card.pts, card.label)}
                      disabled={atMax}
                      className={`relative flex flex-col items-center justify-center rounded-xl border-2 py-2.5 transition-colors active:scale-95 select-none ${
                        currentCount > 0
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-gray-200 bg-white text-gray-700'
                      } ${atMax ? 'opacity-40 cursor-not-allowed' : 'active:bg-brand-100'}`}
                    >
                      <span className="font-bold text-sm leading-tight">{card.display}</span>
                      <span className="text-[9px] text-gray-400 leading-tight mt-0.5">{card.pts}pt</span>
                      {currentCount > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-brand-600 text-white text-[10px] font-bold flex items-center justify-center leading-none">
                          {currentCount}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Selected cards summary + stepper */}
            {editableTokens.length > 0 && (
              <div className="bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Your hand</span>
                  <span className="text-xs font-bold text-brand-700">{tokenTotal} pts</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {editableTokens.map(t => (
                    <div key={t.token} className="flex items-center gap-3 px-3 py-2">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-white border-2 border-gray-300 font-bold text-sm text-gray-800 shadow-sm flex-shrink-0">
                        {t.token === 'JOKER' ? '🃏' : t.token}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{t.label}</p>
                        <p className="text-xs text-gray-400">{t.points} pts each</p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={() => adjustCount(t.token, -1)} className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 active:bg-gray-100">
                          <Minus size={11} />
                        </button>
                        <span className={`w-5 text-center font-bold text-sm ${t.count >= MAX_PER_RANK ? 'text-red-600' : 'text-gray-900'}`}>{t.count}</span>
                        <button
                          onClick={() => adjustCount(t.token, +1)}
                          disabled={t.count >= MAX_PER_RANK}
                          className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 active:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Plus size={11} />
                        </button>
                        <span className="w-8 text-right text-sm font-bold text-brand-700">{t.points * t.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-3 py-2 bg-brand-50 border-t border-brand-100 flex items-center justify-between">
                  <span className="text-sm font-semibold text-brand-700">Total</span>
                  <span className="text-base font-bold text-brand-700">{tokenTotal} pts</span>
                </div>
              </div>
            )}

            {validationError && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">
                <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                <span>{validationError}</span>
              </div>
            )}

            <div className="flex items-center gap-3">
              <hr className="flex-1 border-gray-200" />
              <span className="text-xs text-gray-400">or type score directly</span>
              <hr className="flex-1 border-gray-200" />
            </div>

            <div className="flex items-center gap-3">
              <input
                type="number" inputMode="numeric" min={0}
                value={editableTokens.length > 0 ? String(tokenTotal) : points}
                onChange={e => {
                  setPoints(e.target.value)
                  // Clear grid selection when user types manually (they're overriding)
                  if (editableTokens.length > 0) setEditableTokens([])
                }}
                placeholder="0"
                className="flex-1 text-4xl font-bold text-brand-700 text-center py-3 rounded-2xl border-2 border-gray-200 focus:border-brand-500 focus:outline-none bg-white"
              />
            </div>

            <div className="h-2" />
          </div>

          {/* Save button — pinned to bottom of scroll area via sticky */}
          <div className="sticky bottom-0 px-4 pb-safe pb-4 pt-3 bg-white border-t border-gray-100 space-y-2">
            <button
              onClick={() => {
                const finalScore = editableTokens.length > 0 ? tokenTotal : score
                const err = validateTokens()
                if (err) { setValidationError(err); return }
                if (!isNaN(finalScore) && finalScore >= 0) onConfirm(finalScore, [])
              }}
              disabled={editableTokens.length === 0 && (!validScore)}
              className="btn-primary w-full py-4 text-base gap-2 disabled:opacity-40"
            >
              <Check size={20} />
              Save {editableTokens.length > 0 ? `${tokenTotal} pts` : (validScore ? `${score} pts` : 'score')} for {playerName}
            </button>
          </div>
        </div>
      )}

      {/* ── REVIEW phase ── */}
      {phase === 'review' && (
        <div className="flex-1 flex flex-col overflow-y-auto">

          {/* Photo */}
          <div className="relative flex-shrink-0">
            {capturedImage && <img src={capturedImage} alt="Captured" className="w-full max-h-44 object-cover" />}
            <div className="absolute top-2 left-2 bg-black/60 rounded-lg px-2 py-1 flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-white text-xs font-medium">Image saved</span>
            </div>
            <button onClick={retake} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center">
              <RefreshCw size={14} />
            </button>
          </div>

          <div className="px-4 py-3 space-y-3 flex-1">

            {analyzing && (
              <div className="flex flex-col items-center justify-center gap-3 py-8 text-brand-600 bg-brand-50 rounded-2xl">
                <Loader size={26} className="animate-spin" />
                <span className="text-sm font-medium">Detecting cards…</span>
              </div>
            )}

            {!analyzing && (
              <>
                {/* ── Editable token breakdown ── */}
                {editableTokens.length > 0 && (
                  <div className="bg-gray-50 rounded-2xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">AI detected — tap ± to correct</span>
                      <span className="text-xs font-bold text-brand-700">{tokenTotal} pts</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {editableTokens.map(t => (
                        <div key={t.token} className="flex items-center gap-3 px-4 py-2">
                          <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-white border-2 border-gray-300 font-bold text-sm text-gray-800 shadow-sm flex-shrink-0">
                            {t.token === 'JOKER' || t.token === 'JKR' ? '🃏' : t.token}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800">{t.label}</p>
                            <p className="text-xs text-gray-400">{t.points} pts each</p>
                          </div>
                          {/* Count stepper */}
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button onClick={() => adjustCount(t.token, -1)} className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 active:bg-gray-100">
                              <Minus size={12} />
                            </button>
                            <span className={`w-5 text-center font-bold text-sm ${t.count >= MAX_PER_RANK ? 'text-red-600' : 'text-gray-900'}`}>{t.count}</span>
                            <button
                              onClick={() => adjustCount(t.token, +1)}
                              disabled={t.count >= MAX_PER_RANK}
                              className="w-7 h-7 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 active:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <Plus size={12} />
                            </button>
                            <span className="w-8 text-right text-sm font-bold text-brand-700">{t.points * t.count}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="px-4 py-2 bg-brand-50 border-t border-brand-100 flex items-center justify-between">
                      <span className="text-sm font-semibold text-brand-700">Total</span>
                      <span className="text-sm font-bold text-brand-700">{tokenTotal} pts</span>
                    </div>
                  </div>
                )}

                {aiError && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-sm text-amber-700">
                    <AlertCircle size={15} className="mt-0.5 flex-shrink-0" /><span>{aiError}</span>
                  </div>
                )}

                {/* Raw Vision fragments */}
                {rawFragments.length > 0 && (
                  <div className="rounded-xl border border-gray-200 overflow-hidden text-xs">
                    <button
                      onClick={() => setShowRaw(v => !v)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 text-gray-500 font-medium active:bg-gray-100"
                    >
                      <span>What Vision saw ({rawFragments.length} fragments)</span>
                      <span className="text-gray-400">{showRaw ? '▲' : '▼'}</span>
                    </button>
                    {showRaw && (
                      <div className="px-3 py-2.5 flex flex-wrap gap-1.5 bg-white">
                        {rawFragments.map((f, i) => (
                          <span key={i} className={`px-2 py-0.5 rounded-md font-mono border ${
                            CARD_POINTS[f.toUpperCase()] !== undefined
                              ? 'bg-brand-50 border-brand-200 text-brand-700 font-bold'
                              : 'bg-gray-50 border-gray-200 text-gray-400'
                          }`}>{f}</span>
                        ))}
                      </div>
                    )}
                    <p className="px-3 py-1.5 bg-gray-50 border-t border-gray-100 text-gray-400">
                      <span className="text-brand-600 font-bold">blue</span> = matched card · grey = ignored
                    </p>
                  </div>
                )}

                {/* Score field — synced with token total but overridable */}
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                    {editableTokens.length > 0 ? 'Correct total if needed' : 'Enter score'}
                  </p>
                  <input
                    type="number" inputMode="numeric" min={0} value={points}
                    onChange={e => setPoints(e.target.value)} placeholder="0" autoFocus
                    className="w-full text-5xl font-bold text-brand-700 text-center py-3 rounded-2xl border-2 border-gray-200 focus:border-brand-500 focus:outline-none bg-white"
                  />
                  {validScore && aiScore !== null && score !== aiScore && (
                    <p className="text-center text-xs text-amber-600 mt-1">
                      ⚠ Changed from AI suggestion ({aiScore} pts)
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Validation error + Save button — pinned bottom */}
          {!analyzing && (
            <div className="flex-shrink-0 px-4 pb-safe pb-4 pt-3 bg-white border-t border-gray-100 space-y-2">
              {validationError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">
                  <AlertCircle size={15} className="mt-0.5 flex-shrink-0" />
                  <span>{validationError}</span>
                </div>
              )}
              <button
                onClick={handleSave}
                disabled={!validScore || saving || !!validationError}
                className="btn-primary w-full py-4 text-base gap-2 disabled:opacity-40"
              >
                {saving
                  ? <span className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                  : <><Check size={20} /> Save score for {playerName}</>
                }
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
